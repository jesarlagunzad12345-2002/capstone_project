let foodItems = [];
let diningSpots = [];
let currentFilter = 'all';
let currentSection = 'menu';
let editingFoodId = null;

document.addEventListener('DOMContentLoaded', function() {
    loadFoodItems();
    loadDiningSpots();
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

// ==================== SECTION SWITCHING ====================
function switchSection(section) {
    currentSection = section;

    // Auto-clear search bar when switching sections
    document.getElementById('searchInput').value = '';
    var diningSearch = document.getElementById('diningSearchInput');
    if (diningSearch) diningSearch.value = '';

    var isMenu = (section === 'menu');
    var isDiningSpots = (section === 'diningSpots');

    document.getElementById('menuSection').style.display = isMenu ? 'block' : 'none';
    document.getElementById('diningSpotsSection').style.display = isDiningSpots ? 'block' : 'none';

    document.getElementById('menuTab').classList.toggle('active', isMenu);
    document.getElementById('diningSpotsTab').classList.toggle('active', isDiningSpots);

    // Update add button
    var addBtn = document.getElementById('addBtn');
    if (isMenu) {
        addBtn.setAttribute('data-bs-target', '#addItemModal');
        addBtn.innerHTML = '<i class="bi bi-plus-lg"></i> <span>Add Food Item</span>';
        var catFilters = document.getElementById('categoryFilters');
        if (catFilters) catFilters.style.display = 'flex';
        renderFoodItems();
    } else if (isDiningSpots) {
        addBtn.setAttribute('data-bs-target', '#addDiningSpotModal');
        addBtn.innerHTML = '<i class="bi bi-plus-lg"></i> <span>Add Dining Spot</span>';
        var catFilters = document.getElementById('categoryFilters');
        if (catFilters) catFilters.style.display = 'none';
        showDiningSpots();
    }
}

// ==================== FOOD ITEMS ====================
async function loadFoodItems() {
    try {
        foodItems = await apiGet('/api/food-items');
        if (currentSection === 'menu') {
            renderFoodItems();
        }
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

// ==================== DINING SPOTS ====================
async function loadDiningSpots() {
    try {
        diningSpots = await apiGet('/api/dining-spots');
        if (currentSection === 'diningSpots') {
            showDiningSpots();
        }
    } catch (err) {
        console.error('Failed to load dining spots:', err);
        showToast('Failed to load dining spots', 'error');
    }
}

function showDiningSpots(searchTerm) {
    var container = document.getElementById('diningSpotsContainer');
    var notFound = document.getElementById('diningSpotsNotFound');

    if (!container) return;

    var list = diningSpots;
    var term = searchTerm || '';

    var searchInput = document.getElementById('diningSearchInput');
    if (searchInput && !term) {
        term = searchInput.value.toLowerCase();
    }

    if (term) {
        list = diningSpots.filter(function(spot) {
            var nameMatch = spot.name.toLowerCase().includes(term);
            var tagMatch = spot.tag && spot.tag.toLowerCase().includes(term);
            return nameMatch || tagMatch;
        });
    }

    if (list.length === 0) {
        container.innerHTML = '';
        if (notFound) notFound.style.display = 'block';
        return;
    }

    if (notFound) notFound.style.display = 'none';

    var html = '';
    for (var i = 0; i < list.length; i++) {
        var spot = list[i];
        // Show full description, don't truncate
        var desc = spot.description ? spot.description : 'No description';

        html += `
        <div class="col-sm-6 col-lg-4 col-xl-3">
            <div class="dining-spot-card">
                <div class="dining-spot-img-wrapper">
                    <img src="${spot.image}" alt="${spot.name}">
                    <span class="dining-spot-tag">${spot.tag || 'DINING'}</span>
                    <button class="btn btn-danger btn-sm delete-btn" onclick="deleteDiningSpot('${spot.dining_id}')">
                        <i class="bi bi-trash-fill"></i>
                    </button>
                </div>
                <div class="dining-spot-content">
                    <h6 class="dining-spot-title">${spot.name}</h6>
                    <p class="dining-spot-description">${desc}</p>
                </div>
            </div>
        </div>`;
    }

    container.innerHTML = html;
}

function searchDiningSpots() {
    showDiningSpots();
}

async function saveDiningSpot(event) {
    if (event) event.preventDefault();

    var nameEl = document.getElementById('diningSpotName');
    var tagEl = document.getElementById('diningSpotTag');
    var descEl = document.getElementById('diningSpotDescription');
    var imgEl = document.getElementById('diningSpotImageBase64');

    if (!nameEl || !tagEl) {
        showToast('Form elements not found', 'error');
        return;
    }

    var name = nameEl.value.trim();
    var tag = tagEl.value.trim();
    var description = descEl ? descEl.value.trim() : '';
    var image = imgEl && imgEl.value ? imgEl.value : 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600';

    if (!name || !tag) {
        showToast('Please enter name and tag', 'error');
        return;
    }

    var nextNumber = diningSpots.length + 1;
    var dining_id = 'DS' + String(nextNumber).padStart(3, '0');

    try {
        await apiPost('/api/dining-spots', {
            dining_id: dining_id,
            name: name,
            tag: tag,
            description: description,
            image: image
        });

        await loadDiningSpots();
        resetDiningSpotForm();

        var modalEl = document.getElementById('addDiningSpotModal');
        if (modalEl) {
            var modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();
        }

        showToast('Dining spot added!', 'success');
    } catch (err) {
        console.error('Error saving dining spot:', err);
        showToast('Failed to add dining spot', 'error');
    }
}

async function deleteDiningSpot(id) {
    if (!confirm('Delete this dining spot?')) return;

    try {
        await apiDelete('/api/dining-spots/' + id);
        await loadDiningSpots();
        showToast('Dining spot deleted', 'success');
    } catch (err) {
        console.error('Error deleting dining spot:', err);
        showToast('Failed to delete dining spot', 'error');
    }
}

// ==================== IMAGE HANDLERS ====================
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

function handleDiningSpotImageUpload(input) {
    var file = input.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
        showToast('File too big! Max 5MB', 'error');
        input.value = '';
        return;
    }

    var uploadArea = document.getElementById('diningUploadArea');
    var preview = document.getElementById('diningSpotImagePreview');
    var base64Input = document.getElementById('diningSpotImageBase64');
    var uploadIcon = document.getElementById('diningUploadIcon');
    var uploadText = document.getElementById('diningUploadText');

    var reader = new FileReader();
    reader.onload = function(e) {
        if (base64Input) base64Input.value = e.target.result;
        if (preview) {
            preview.src = e.target.result;
            preview.classList.add('show');
        }
        if (uploadArea) uploadArea.classList.add('has-file');
        if (uploadIcon) uploadIcon.style.display = 'none';
        if (uploadText) uploadText.textContent = file.name;
    };
    reader.readAsDataURL(file);
}

// ==================== FORM RESETS ====================
function resetForm() {
    var form = document.getElementById('addFoodForm');
    if (form) form.reset();

    var imgBase = document.getElementById('foodImageBase64');
    if (imgBase) imgBase.value = '';

    var preview = document.getElementById('imagePreview');
    if (preview) preview.classList.remove('show');

    var uploadArea = document.getElementById('uploadArea');
    if (uploadArea) uploadArea.classList.remove('has-file');

    var uploadIcon = document.getElementById('uploadIcon');
    if (uploadIcon) uploadIcon.style.display = 'block';

    var uploadText = document.getElementById('uploadText');
    if (uploadText) uploadText.textContent = 'Click to upload food photo';
}

function resetDiningSpotForm() {
    var form = document.getElementById('addDiningSpotForm');
    if (form) form.reset();

    var imgBase = document.getElementById('diningSpotImageBase64');
    if (imgBase) imgBase.value = '';

    var preview = document.getElementById('diningSpotImagePreview');
    if (preview) preview.classList.remove('show');

    var uploadArea = document.getElementById('diningUploadArea');
    if (uploadArea) uploadArea.classList.remove('has-file');

    var uploadIcon = document.getElementById('diningUploadIcon');
    if (uploadIcon) uploadIcon.style.display = 'block';

    var uploadText = document.getElementById('diningUploadText');
    if (uploadText) uploadText.textContent = 'Click to upload spot photo';
}

// ==================== UTILS ====================
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
    return 'popularity-' + popularity.split(' ').join('-');
}

function showToast(message, type) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'custom-toast ' + type;
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
    var sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.toggle('active');
}