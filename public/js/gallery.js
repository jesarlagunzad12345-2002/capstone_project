let currentFilter = 'all';
let rooms = [];
let mountainViews = [];
let foodItems = [];

// Start: Load all data from API
document.addEventListener('DOMContentLoaded', function() {
    loadAllData();
});


async function apiGet(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function loadAllData() {
    try {
        const data = await apiGet('/api/gallery');
        rooms = data.rooms || [];
        mountainViews = data.mountainViews || [];
        foodItems = data.dining || [];
        showGallery();
    } catch (err) {
        console.error('Failed to load gallery:', err);
        document.getElementById('galleryContainer').innerHTML = `
            <div class="col-12 text-center py-5">
                <i class="bi bi-images text-muted" style="font-size: 4rem;"></i>
                <h4 class="mt-3 text-muted">Failed to Load Gallery</h4>
                <p class="text-muted">Please try again later.</p>
            </div>
        `;
    }
}


function filterGallery(category) {
    currentFilter = category;

    document.querySelectorAll('#galleryFilters button').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');

    showGallery();
}

function searchGallery() {
    showGallery();
}


function showGallery() {
    const container = document.getElementById('galleryContainer');
    const searchTerm = document.getElementById('gallerySearch').value.toLowerCase();

    let html = '';
    let hasResults = false;

    if (currentFilter === 'all' || currentFilter === 'rooms') {
        let list = rooms;

        if (searchTerm) {
            list = list.filter(r => r.name.toLowerCase().includes(searchTerm));
        }

        if (list.length > 0) {
            hasResults = true;
            html += list.map(room => `
                <div class="col-md-6 col-lg-4">
                    <div class="room-gallery-card">
                        <span class="room-category-badge">${room.category}</span>
                        <span class="room-price">₱${room.price}</span>
                        <span class="room-status-badge status-${room.status}">${room.status}</span>
                        <img src="${room.image}" alt="${room.name}">
                        <div class="room-gallery-content">
                            <h4>${room.name}</h4>
                            <p>${room.occupancy} Guests • ${room.id}</p>
                            <div class="d-flex gap-2">
                                <button class="btn btn-details-gallery w-100" onclick="showRoomModal('${room.id}')">View Details</button>
                            </div>
                        </div>
                    </div>
                </div>
            `).join('');
        }
    }

    if (currentFilter === 'all' || currentFilter === 'mountain') {
        let list = mountainViews;

        if (searchTerm) {
            list = list.filter(v => v.name.toLowerCase().includes(searchTerm));
        }

        if (list.length > 0) {
            hasResults = true;
            html += list.map(view => `
                <div class="col-md-6 col-lg-4">
                    <div class="mountain-gallery-card">
                        <span class="mountain-gallery-location"><i class="bi bi-geo-alt-fill"></i> ${view.location}</span>
                        <img src="${view.image}" alt="${view.name}">
                        <div class="mountain-gallery-content">
                            <h4>${view.name}</h4>
                            <p><i class="bi bi-map"></i> ${view.location}</p>
                        </div>
                    </div>
                </div>
            `).join('');
        }
    }

    if (currentFilter === 'all' || currentFilter === 'dining') {
        let list = foodItems;

        if (searchTerm) {
            list = list.filter(item => item.name.toLowerCase().includes(searchTerm));
        }

        if (list.length > 0) {
            hasResults = true;
            html += list.map(item => {
                const isOutOfStock = item.stock_status === 'Out of Stock';
                const popClass = item.popularity ? 'badge-' + item.popularity.toLowerCase().replace(/\s+/g, '-') : '';
                const stockClass = item.stock_status === 'In Stock' ? 'stock-in' : item.stock_status === 'Low Stock' ? 'stock-low' : 'stock-out';

                return `
                <div class="col-md-6 col-lg-4">
                    <div class="dining-gallery-card ${isOutOfStock ? 'opacity-75' : ''}">
                        ${item.popularity ? `<span class="popularity-badge ${popClass}">${item.popularity}</span>` : ''}
                        <span class="dining-price-badge">₱${parseFloat(item.price).toFixed(2)}</span>
                        <span class="dining-stock-badge ${stockClass}">${item.stock_status}</span>
                        <img src="${item.image}" alt="${item.name}" style="${isOutOfStock ? 'filter: grayscale(0.6)' : ''}">
                        <div class="dining-gallery-content">
                            <h4>${item.name}</h4>
                            <p class="dining-category"><i class="bi bi-tag-fill"></i> ${item.category}</p>
                            <button class="btn btn-details-gallery w-100" onclick="showFoodModal('${item.id}')">View Details</button>
                        </div>
                    </div>
                </div>
                `;
            }).join('');
        }
    }

    if (!hasResults) {
        html = `
            <div class="col-12 text-center py-5">
                <i class="bi bi-images text-muted" style="font-size: 4rem;"></i>
                <h4 class="mt-3 text-muted">No items found</h4>
                <p class="text-muted">Try a different search or filter</p>
            </div>
        `;
    }

    container.innerHTML = html;
}


async function showRoomModal(roomId) {
    try {
        const room = await apiGet(`/api/rooms/${roomId}`);

        document.getElementById('modalRoomImage').src = room.image;
        document.getElementById('modalRoomName').textContent = room.name;
        document.getElementById('modalRoomCategory').textContent = room.category;
        document.getElementById('modalRoomPrice').textContent = room.price;
        document.getElementById('modalRoomOccupancy').textContent = room.occupancy;
        document.getElementById('modalRoomStatus').textContent = room.status;
        document.getElementById('modalRoomStatus').className = 'room-status-badge modal-status status-' + room.status;

        const bookBtn = document.getElementById('modalBookBtn');
        if (room.status === 'available') {
            bookBtn.href = `/booking?room=${room.room_id}`;
            bookBtn.classList.remove('disabled');
        } else {
            bookBtn.href = '#';
            bookBtn.classList.add('disabled');
        }

        new bootstrap.Modal(document.getElementById('roomDetailsModal')).show();
    } catch (err) {
        console.error('Error loading room details:', err);
    }
}

async function showFoodModal(foodId) {
    try {
        const item = await apiGet(`/api/food-items/${foodId}`);

        document.getElementById('modalFoodImage').src = item.image;
        document.getElementById('modalFoodName').textContent = item.name;
        document.getElementById('modalFoodCategory').textContent = item.category;
        document.getElementById('modalFoodPrice').textContent = parseFloat(item.price).toFixed(2);
        document.getElementById('modalFoodDescription').textContent = item.description;

        const popBadge = document.getElementById('modalFoodPopularity');
        if (item.popularity) {
            popBadge.textContent = item.popularity;
            popBadge.className = 'popularity-badge modal-popularity popularity-' + item.popularity.replace(/\s+/g, '-');
            popBadge.style.display = 'inline-block';
        } else {
            popBadge.style.display = 'none';
        }
        const stockDetail = document.getElementById('modalFoodStockDetail');
        stockDetail.innerHTML = `<i class="bi bi-box-seam"></i> ${item.stock_status}`;
        stockDetail.className = item.stock_status === 'In Stock' ? 'text-success' : item.stock_status === 'Low Stock' ? 'text-warning' : 'text-danger';

        new bootstrap.Modal(document.getElementById('foodDetailsModal')).show();
    } catch (err) {
        console.error('Error loading food details:', err);
    }
}