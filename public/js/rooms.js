let rooms = [];
let mountainViews = [];
let currentFilter = 'all';
let currentSection = 'rooms';
let editingRoomId = null;

document.addEventListener('DOMContentLoaded', function() {
    loadRooms();
    loadMountainViews();
    updateStats();
});

const api = {
    get: function(url) {
        return fetch(url)
            .then(function(response) {
                if (response.ok) return response.json();
                throw new Error('HTTP ' + response.status);
            });
    },
    
    post: function(url, data) {
        return fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        }).then(function(response) {
            if (response.ok) return response.json();
            throw new Error('HTTP ' + response.status);
        });
    },
    
    patch: function(url, data) {
        return fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        }).then(function(response) {
            if (response.ok) return response.json();
            throw new Error('HTTP ' + response.status);
        });
    },
    
    delete: function(url) {
        return fetch(url, { method: 'DELETE' })
            .then(function(response) {
                if (response.ok) return response.json();
                throw new Error('HTTP ' + response.status);
            });
    }
};

function switchSection(section) {
    currentSection = section;
    var isRooms = (section === 'rooms');
    
    document.getElementById('roomsSection').style.display = isRooms ? 'block' : 'none';
    document.getElementById('mountainSection').style.display = isRooms ? 'none' : 'block';
    
    document.getElementById('roomsTab').classList.toggle('active', isRooms);
    document.getElementById('mountainTab').classList.toggle('active', !isRooms);
    
    document.getElementById('addBtn').style.display = isRooms ? 'flex' : 'none';
}

function handleSearch() {
    var searchTerm = document.getElementById('searchInput').value.toLowerCase();
    
    if (currentSection === 'rooms') {
        showRooms(searchTerm);
    } else {
        showMountainViews(searchTerm);
    }
}

async function loadRooms() {
    try {
        rooms = await api.get('/api/rooms');
        showRooms();
    } catch (err) {
        console.error('Failed to load rooms:', err);
        showToast('Failed to load rooms', 'error');
    }
}

function showRooms(searchTerm) {
    searchTerm = (searchTerm || '').toLowerCase();
    
    var container = document.getElementById('roomsContainer');
    var notFound = document.getElementById('roomsNotFound');
    
    var list = rooms;
    
    if (currentFilter !== 'all') {
        list = rooms.filter(function(room) {
            return room.category === currentFilter;
        });
    }
    
    if (searchTerm) {
        list = list.filter(function(room) {
            var nameMatch = room.name.toLowerCase().includes(searchTerm);
            var idMatch = room.room_id.toLowerCase().includes(searchTerm);
            return nameMatch || idMatch;
        });
    }
    
    if (list.length === 0) {
        container.innerHTML = '';
        updateNotFoundMessage();
        notFound.style.display = 'block';
        return;
    }
    
    notFound.style.display = 'none';
    
    var html = '';
    for (var i = 0; i < list.length; i++) {
        var room = list[i];
        var isAvailable = (room.status === 'available');
        
        html += `
        <div class="col-sm-6 col-xl-3">
            <div class="room-card">
                <div class="room-img-wrapper">
                    <img src="${room.image}" alt="${room.name}">
                    <div class="room-id">${room.room_id}</div>
                </div>
                <div class="status-pill status-${room.status}" onclick="openStatusMenu('${room.room_id}', event)">
                    ${room.status.toUpperCase()} ▼
                </div>
                <div class="p-3">
                    <div class="d-flex justify-content-between">
                        <h6 class="fw-bold mb-1">${room.name}</h6>
                        <span class="text-info fw-bold">₱${room.price}<small class="text-muted">/night</small></span>
                    </div>
                    <p class="text-muted mb-3" style="font-size: 0.75rem;">${room.occupancy} Guests • ${room.category}</p>
                    <div class="room-actions">
                        <button class="btn btn-light btn-sm flex-grow-1 fw-bold" onclick="showRoomDetails('${room.room_id}')">DETAILS</button>
                        <button class="btn btn-info btn-sm flex-grow-1 fw-bold text-white" onclick="bookRoom('${room.room_id}')" ${isAvailable ? '' : 'disabled'}>BOOK NOW</button>
                    </div>
                </div>
            </div>
        </div>`;
    }
    
    container.innerHTML = html;
}

function filterRooms(category) {
    currentFilter = category;
    
    var buttons = document.querySelectorAll('#categoryFilters button');
    for (var i = 0; i < buttons.length; i++) {
        var btn = buttons[i];
        var isActive = false;
        
        if (category === 'all' && btn.textContent === 'All Rooms & Cottage') {
            isActive = true;
        } else if (btn.textContent === category) {
            isActive = true;
        }
        
        if (isActive) {
            btn.className = 'btn btn-dark btn-sm rounded-2 px-3 active';
        } else {
            btn.className = 'btn btn-link btn-sm text-muted text-decoration-none px-3';
        }
    }
    
    var currentSearch = document.getElementById('searchInput').value;
    showRooms(currentSearch);
}

function updateNotFoundMessage() {
    var title = document.querySelector('#roomsNotFound h5');
    var text = document.querySelector('#roomsNotFound p');
    
    if (currentFilter === 'all') {
        title.textContent = 'No Rooms or Cottage Found';
        text.textContent = 'No rooms or cottages match your search criteria. Try different keywords or filters.';
    } else if (currentFilter === 'Cottage') {
        title.textContent = 'No Cottage Found';
        text.textContent = 'No cottages match your search criteria. Try different keywords or add new cottages.';
    } else {
        title.textContent = 'No Rooms Found';
        text.textContent = 'No ' + currentFilter + ' rooms match your search criteria. Try different keywords or filters.';
    }
}

async function saveRoom() {
    var name = document.getElementById('roomName').value.trim();
    var number = document.getElementById('roomNumber').value.trim();
    var category = document.getElementById('roomCategory').value;
    var price = parseFloat(document.getElementById('roomPrice').value) || 0;
    var occupancy = parseInt(document.getElementById('roomOccupancy').value) || 2;
    var status = document.getElementById('roomStatus').value;
    var image = document.getElementById('roomImageBase64').value || 'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=600';
    
    if (!name || !number) {
        alert('Please fill in room or cottage name and number');
        return;
    }
    
    var prefix = (category === 'Cottage') ? 'C' : 'RM';
    var room_id = prefix + ' ' + number;
    
    var exists = false;
    for (var i = 0; i < rooms.length; i++) {
        if (rooms[i].room_id === room_id) {
            exists = true;
            break;
        }
    }
    
    if (exists) {
        showToast('Room number "' + room_id + '" already exists! Please use a different number.', 'error');
        document.getElementById('roomNumber').focus();
        return;
    }
    
    try {
        await api.post('/api/rooms', {
            room_id: room_id,
            name: name,
            category: category,
            price: price,
            occupancy: occupancy,
            status: status,
            image: image
        });
        
        await loadRooms();
        updateStats();
        resetForm();
        
        var modal = bootstrap.Modal.getInstance(document.getElementById('addRoomModal'));
        modal.hide();
        
        showToast('Room added!', 'success');
    } catch (err) {
        console.error('Error saving room:', err);
        showToast('Failed to add room', 'error');
    }
}

async function deleteRoom(id) {
    if (!confirm('Delete this room?')) return;
    
    try {
        await api.delete('/api/rooms/' + id);
        await loadRooms();
        updateStats();
        showToast('Room deleted', 'success');
        
        var modal = bootstrap.Modal.getInstance(document.getElementById('roomDetailsModal'));
        if (modal) modal.hide();
    } catch (err) {
        console.error('Error deleting room:', err);
        showToast('Failed to delete room', 'error');
    }
}

async function showRoomDetails(id) {
    try {
        var room = await api.get('/api/rooms/' + id);
        
        var badgeColor = 'secondary';
        if (room.status === 'available') badgeColor = 'success';
        if (room.status === 'occupied') badgeColor = 'danger';
        if (room.status === 'cleaning') badgeColor = 'warning';
        
        var isAvailable = (room.status === 'available');
        
        document.getElementById('detailsRoomName').textContent = room.name;
        document.getElementById('detailsContent').innerHTML = `
            <div class="text-center mb-3">
                <img src="${room.image}" class="img-fluid rounded-3" style="max-height: 200px;">
            </div>
            <div class="row g-3">
                <div class="col-6"><strong>ID:</strong> ${room.room_id}</div>
                <div class="col-6"><strong>Category:</strong> ${room.category}</div>
                <div class="col-6"><strong>Price:</strong> ₱${room.price}/night</div>
                <div class="col-6"><strong>Guests:</strong> ${room.occupancy}</div>
                <div class="col-6">
                    <strong>Status:</strong> 
                    <span class="badge bg-${badgeColor}">${room.status}</span>
                </div>
            </div>
            <div class="mt-4 d-flex gap-2">
                <button class="btn btn-info text-white flex-grow-1" onclick="bookRoom('${room.room_id}')" ${isAvailable ? '' : 'disabled'}>Book Now</button>
                <button class="btn btn-outline-danger" onclick="deleteRoom('${room.room_id}')">
                    <i class="bi bi-trash"></i>
                </button>
            </div>
        `;
        
        new bootstrap.Modal(document.getElementById('roomDetailsModal')).show();
    } catch (err) {
        console.error('Error loading room details:', err);
        showToast('Failed to load room details', 'error');
    }
}

function openStatusMenu(roomId, event) {
    event.stopPropagation();
    editingRoomId = roomId;
    
    var dropdown = document.getElementById('globalStatusDropdown');
    var rect = event.currentTarget.getBoundingClientRect();
    
    dropdown.style.top = (rect.bottom + 5) + 'px';
    dropdown.style.left = rect.left + 'px';
    dropdown.classList.add('show');
}

async function changeStatus(newStatus) {
    if (!editingRoomId) return;
    
    try {
        await api.patch('/api/rooms/' + editingRoomId + '/status', { status: newStatus });
        await loadRooms();
        showToast('Room is now ' + newStatus, 'success');
    } catch (err) {
        console.error('Error changing status:', err);
        showToast('Failed to change status', 'error');
    }
    
    document.getElementById('globalStatusDropdown').classList.remove('show');
    editingRoomId = null;
}

document.addEventListener('click', function(e) {
    if (!e.target.closest('.status-pill')) {
        document.getElementById('globalStatusDropdown').classList.remove('show');
        editingRoomId = null;
    }
});

async function loadMountainViews() {
    try {
        mountainViews = await api.get('/api/mountain-views');
        showMountainViews();
    } catch (err) {
        console.error('Failed to load mountain views:', err);
        showToast('Failed to load mountain views', 'error');
    }
}

function showMountainViews(searchTerm) {
    var container = document.getElementById('mountainContainer');
    var notFound = document.getElementById('mountainNotFound');
    
    var list = mountainViews;
    
    if (searchTerm) {
        list = mountainViews.filter(function(view) {
            var titleMatch = view.title.toLowerCase().includes(searchTerm);
            var locationMatch = view.location.toLowerCase().includes(searchTerm);
            return titleMatch || locationMatch;
        });
    }
    
    if (list.length === 0) {
        container.innerHTML = '';
        notFound.style.display = 'block';
        return;
    }
    
    notFound.style.display = 'none';
    
    var html = '';
    for (var i = 0; i < list.length; i++) {
        var view = list[i];
        html += `
        <div class="col-sm-6 col-lg-4 col-xl-3">
            <div class="mountain-card">
                <div class="mountain-img-wrapper">
                    <img src="${view.image}" alt="${view.title}">
                    <button class="btn btn-danger btn-sm delete-btn" onclick="deleteMountainView('${view.view_id}')">
                        <i class="bi bi-trash-fill"></i>
                    </button>
                </div>
                <div class="mountain-content">
                    <h6 class="mountain-title">${view.title}</h6>
                    <p class="mountain-location">
                        <i class="bi bi-geo-alt-fill me-1"></i>${view.location}
                    </p>
                </div>
            </div>
        </div>`;
    }
    
    container.innerHTML = html;
}

async function saveMountainView() {
    var title = document.getElementById('mountainTitle').value.trim();
    var location = document.getElementById('mountainLocation').value.trim();
    var image = document.getElementById('mountainImageBase64').value || 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=600';
    
    if (!title) {
        alert('Please enter a title');
        return;
    }
    
    var nextNumber = mountainViews.length + 1;
    var view_id = 'MT' + String(nextNumber).padStart(3, '0');
    
    try {
        await api.post('/api/mountain-views', {
            view_id: view_id,
            title: title,
            location: location || 'Unknown',
            image: image
        });
        
        await loadMountainViews();
        resetMountainForm();
        
        var modal = bootstrap.Modal.getInstance(document.getElementById('addMountainModal'));
        modal.hide();
        
        showToast('Mountain view added!', 'success');
    } catch (err) {
        console.error('Error saving mountain view:', err);
        showToast('Failed to add mountain view', 'error');
    }
}

async function deleteMountainView(id) {
    if (!confirm('Delete this view?')) return;
    
    try {
        await api.delete('/api/mountain-views/' + id);
        await loadMountainViews();
        showToast('View deleted', 'success');
    } catch (err) {
        console.error('Error deleting mountain view:', err);
        showToast('Failed to delete view', 'error');
    }
}

function handleImageUpload(input) {
    var file = input.files[0];
    if (!file) return;
    
    if (file.size > 5 * 1024 * 1024) {
        alert('File too big! Max 5MB');
        return;
    }
    
    var reader = new FileReader();
    reader.onload = function(e) {
        document.getElementById('roomImageBase64').value = e.target.result;
        var preview = document.getElementById('imagePreview');
        preview.src = e.target.result;
        preview.classList.add('show');
    };
    reader.readAsDataURL(file);
}

function handleMountainImageUpload(input) {
    var file = input.files[0];
    if (!file) return;
    
    if (file.size > 5 * 1024 * 1024) {
        alert('File too big! Max 5MB');
        return;
    }
    
    var reader = new FileReader();
    reader.onload = function(e) {
        document.getElementById('mountainImageBase64').value = e.target.result;
        var preview = document.getElementById('mountainImagePreview');
        preview.src = e.target.result;
        preview.classList.add('show');
    };
    reader.readAsDataURL(file);
}

function resetForm() {
    document.getElementById('roomName').value = '';
    document.getElementById('roomNumber').value = '';
    document.getElementById('roomPrice').value = '';
    document.getElementById('roomImageBase64').value = '';
    document.getElementById('roomOccupancy').value = '2';
    document.getElementById('roomCategory').value = 'Standard';
    document.getElementById('roomStatus').value = 'available';
    document.getElementById('imagePreview').classList.remove('show');
}

function resetRoomForm() {
    resetForm();
}

function resetMountainForm() {
    document.getElementById('mountainTitle').value = '';
    document.getElementById('mountainLocation').value = '';
    document.getElementById('mountainImageBase64').value = '';
    document.getElementById('mountainImagePreview').classList.remove('show');
}

async function updateStats() {
    try {
        var stats = await api.get('/api/rooms/stats/overview');
        document.getElementById('totalRoomsBadge').textContent = 'Total: ' + stats.total + ' Rooms';
        document.getElementById('totalCottagesBadge').textContent = 'Cottages: ' + stats.cottages;
        document.getElementById('availableRoomsBadge').textContent = 'Available: ' + stats.available;
    } catch (err) {
        console.error('Error loading stats:', err);
    }
}

function bookRoom(roomId) {
    window.location.href = '/booking?room=' + roomId;
}

function showToast(message, type) {
    var container = document.getElementById('toastContainer');
    var toast = document.createElement('div');
    
    var icon = (type === 'success') ? 'check-circle' : 'exclamation-circle';
    
    toast.className = 'custom-toast ' + type;
    toast.innerHTML = '<i class="bi bi-' + icon + '"></i> <span>' + message + '</span>';
    
    container.appendChild(toast);
    
    setTimeout(function() {
        toast.classList.add('show');
    }, 10);
    
    setTimeout(function() {
        toast.remove();
    }, 3000);
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('active');
}