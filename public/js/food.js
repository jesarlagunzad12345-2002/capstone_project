let foodItems = [];
let currentFilter = 'all';
let editingFoodId = null;

document.addEventListener('DOMContentLoaded', function() {
    loadFoodItems();
});

async function apiGet(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function apiPost(url, data) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function apiPut(url, data) {
    const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function apiDelete(url) {
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}


async function loadFoodItems() {
    try {
        foodItems = await apiGet('/api/food-items');
        renderFoodItems();
    } catch (err) {
        console.error('Failed to load food items:', err);
        showToast('Failed to load food items', 'error');
    }
}

function renderFoodItems() {
    const container = document.getElementById('foodContainer');
    let filtered = currentFilter === 'all' ? foodItems : foodItems.filter(f => f.category === currentFilter);
    
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    if (searchTerm) {
        filtered = filtered.filter(f => 
            f.name.toLowerCase().includes(searchTerm) || 
            f.description.toLowerCase().includes(searchTerm) ||
            f.category.toLowerCase().includes(searchTerm)
        );
    }

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="col-12 text-center py-5">
                <i class="bi bi-egg-fried text-muted" style="font-size: 4rem;"></i>
                <h5 class="mt-3 text-muted">No Food Items Found</h5>
                <p class="text-muted">Add food items to display them here</p>
            </div>
        `;
        return;
    }

    container.innerHTML = filtered.map(item => {
        const isOutOfStock = item.stock_status === 'Out of Stock';
        const stockColor = getStockColor(item.stock_status);
        const popClass = getPopularityClass(item.popularity);
        const popText = item.popularity || '';
        
        return `
        <div class="col-12 col-sm-6 col-xl-4 col-xxl-3">
            <div class="food-card">
                <div class="food-img-wrapper ${isOutOfStock ? 'out-of-stock' : ''}">
                    <img src="${item.image}" alt="${item.name}">
                    ${popText ? `<div class="popularity-tag ${popClass}">${popText}</div>` : ''}
                    ${isOutOfStock ? '<div class="out-badge"><span>OUT OF STOCK</span></div>' : ''}
                </div>
                <div class="p-3">
                    <div class="d-flex justify-content-between align-items-start mb-2">
                        <h6 class="fw-bold mb-0 ${isOutOfStock ? 'opacity-50' : ''}">${item.name}</h6>
                        <span class="text-primary fw-bold ${isOutOfStock ? 'opacity-50' : ''}">₱${parseFloat(item.price).toFixed(2)}</span>
                    </div>
                    <p class="text-muted small mb-4 ${isOutOfStock ? 'opacity-50' : ''}">${item.description}</p>
                    <div class="d-flex justify-content-between align-items-center pt-3 border-top">
                        <div>
                            <label class="d-block text-muted text-uppercase fw-bold" style="font-size: 10px;">Stock Status</label>
                            <span class="small fw-bold ${stockColor}">${item.stock_status} ${item.stock_qty > 0 ? '(' + item.stock_qty + ')' : ''}</span>
                        </div>
                        <div class="btn-group btn-group-sm gap-1">
                            <button class="btn btn-light border" onclick="editFoodItem('${item.food_id}')"><i class="bi bi-pencil"></i></button>
                            <button class="btn btn-light border text-danger" onclick="deleteFoodItem('${item.food_id}')"><i class="bi bi-trash"></i></button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `}).join('');
}

async function saveFoodItem(event) {
    event.preventDefault();
    
    const name = document.getElementById('foodName').value.trim();
    const category = document.getElementById('foodCategory').value;
    const price = parseFloat(document.getElementById('foodPrice').value) || 0;
    const popularity = document.getElementById('foodPopularity').value;
    const description = document.getElementById('foodDescription').value.trim();
    const stock_status = document.getElementById('foodStockStatus').value;
    const stock_qty = parseInt(document.getElementById('foodStockQty').value) || 0;
    const image = document.getElementById('foodImageBase64').value || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600';

    if (!name || !category || !price || !popularity || !description) {
        showToast('Please fill in all required fields', 'error');
        return;
    }

    try {
        await apiPost('/api/food-items', { 
            name, 
            category, 
            price, 
            popularity, 
            description, 
            stock_status, 
            stock_qty, 
            image 
        });
        await loadFoodItems();
        resetForm();
        bootstrap.Modal.getInstance(document.getElementById('addItemModal')).hide();
        showToast('Food item added successfully!', 'success');
    } catch (err) {
        console.error('Error saving food item:', err);
        showToast('Failed to add food item', 'error');
    }
}

async function editFoodItem(id) {
    try {
        const item = await apiGet(`/api/food-items/${id}`);
        if (!item) return;

        editingFoodId = id;
        document.getElementById('editFoodId').value = id;
        document.getElementById('editFoodName').value = item.name;
        document.getElementById('editFoodCategory').value = item.category;
        document.getElementById('editFoodPrice').value = item.price;
        document.getElementById('editFoodPopularity').value = item.popularity || 'POPULAR';
        document.getElementById('editFoodDescription').value = item.description;
        document.getElementById('editFoodStockStatus').value = item.stock_status;
        document.getElementById('editFoodStockQty').value = item.stock_qty;

        new bootstrap.Modal(document.getElementById('editItemModal')).show();
    } catch (err) {
        console.error('Error loading food item:', err);
        showToast('Failed to load food item', 'error');
    }
}

async function updateFoodItem(event) {
    event.preventDefault();
    
    const id = document.getElementById('editFoodId').value;
    
    const data = {
        name: document.getElementById('editFoodName').value.trim(),
        category: document.getElementById('editFoodCategory').value,
        price: parseFloat(document.getElementById('editFoodPrice').value) || 0,
        popularity: document.getElementById('editFoodPopularity').value,
        description: document.getElementById('editFoodDescription').value.trim(),
        stock_status: document.getElementById('editFoodStockStatus').value,
        stock_qty: parseInt(document.getElementById('editFoodStockQty').value) || 0
    };

    try {
        await apiPut(`/api/food-items/${id}`, data);
        await loadFoodItems();
        bootstrap.Modal.getInstance(document.getElementById('editItemModal')).hide();
        showToast('Food item updated successfully!', 'success');
    } catch (err) {
        console.error('Error updating food item:', err);
        showToast('Failed to update food item', 'error');
    }
}

async function deleteFoodItem(id) {
    if (!confirm('Are you sure you want to delete this food item?')) return;
    
    try {
        await apiDelete(`/api/food-items/${id}`);
        await loadFoodItems();
        showToast('Food item deleted successfully', 'success');
    } catch (err) {
        console.error('Error deleting food item:', err);
        showToast('Failed to delete food item', 'error');
    }
}

function filterFood(category) {
    currentFilter = category;
    
    document.querySelectorAll('#categoryFilters button').forEach(btn => {
        if ((category === 'all' && btn.textContent === 'All Items') || btn.textContent === category) {
            btn.className = 'btn btn-dark btn-sm rounded-2 px-3 active';
        } else {
            btn.className = 'btn btn-link btn-sm text-muted rounded-2 px-3 text-decoration-none';
        }
    });
    
    renderFoodItems();
}

function searchFood() {
    renderFoodItems();
}

function getStockColor(status) {
    const colors = {
        'In Stock': 'text-success',
        'Low Stock': 'text-warning',
        'Out of Stock': 'text-danger'
    };
    return colors[status] || 'text-muted';
}

function getPopularityClass(popularity) {
    if (!popularity) return '';
    return 'popularity-' + popularity.replace(/\s+/g, '-');
}

function handleImageUpload(input) {
    const file = input.files[0];
    const uploadArea = document.getElementById('uploadArea');
    const preview = document.getElementById('imagePreview');
    const base64Input = document.getElementById('foodImageBase64');
    const uploadIcon = document.getElementById('uploadIcon');
    const uploadText = document.getElementById('uploadText');
    
    if (file) {
        if (file.size > 5 * 1024 * 1024) {
            showToast('File size must be less than 5MB', 'error');
            input.value = '';
            return;
        }
        
        const reader = new FileReader();
        reader.onload = function(e) {
            base64Input.value = e.target.result;
            preview.src = e.target.result;
            preview.classList.add('show');
            uploadArea.classList.add('has-file');
            uploadIcon.style.display = 'none';
            uploadText.textContent = file.name;
        };
        reader.readAsDataURL(file);
    }
}

function resetForm() {
    document.getElementById('addFoodForm').reset();
    document.getElementById('foodImageBase64').value = '';
    document.getElementById('imagePreview').classList.remove('show');
    document.getElementById('uploadArea').classList.remove('has-file');
    document.getElementById('uploadIcon').style.display = 'block';
    document.getElementById('uploadText').textContent = 'Click to upload food photo';
}

function showToast(message, type) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `custom-toast ${type}`;
    toast.innerHTML = `
        <i class="bi bi-${type === 'success' ? 'check-circle-fill' : 'exclamation-circle-fill'}"></i>
        <span>${message}</span>
    `;
    container.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('active');
}