let rooms = [];
let roomModal;

document.addEventListener('DOMContentLoaded', function() {
    roomModal = new bootstrap.Modal(document.getElementById('roomModal'));
    loadRooms();
    setupSearch();
});

async function apiGet(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function loadRooms() {
    try {
        rooms = await apiGet('/api/rooms');
        renderAccommodations();
    } catch (err) {
        console.error('Failed to load accommodations:', err);
        document.querySelector('.accommodations-wrapper').innerHTML = `
            <div class="text-center py-5">
                <i class="bi bi-house-door text-muted" style="font-size: 4rem;"></i>
                <h4 class="mt-3 text-muted">Failed to Load Accommodations</h4>
                <p class="text-muted">Please try again later.</p>
            </div>
        `;
    }
}

function renderAccommodations() {
    const wrapper = document.querySelector('.accommodations-wrapper');

    const loader = document.getElementById('loadingState');
    if (loader) loader.remove();

    if (rooms.length === 0) {
        wrapper.innerHTML = `
            <div class="text-center py-5">
                <i class="bi bi-house-door text-muted" style="font-size: 4rem;"></i>
                <h4 class="mt-3 text-muted">No Accommodations Available</h4>
                <p class="text-muted">Check back soon for new room offerings.</p>
            </div>
        `;
        return;
    }

    wrapper.innerHTML = rooms.map((room, index) => {
        const isEven = index % 2 === 0;
        const statusBadge = room.status === 'available' 
            ? '<span class="badge bg-success me-2">Available</span>' 
            : room.status === 'occupied' 
                ? '<span class="badge bg-danger me-2">Occupied</span>' 
                : '<span class="badge bg-warning text-dark me-2">Cleaning</span>';

        // Add booking schedule hint
        const bookingHint = room.status !== 'available' 
            ? `<p class="text-muted small mb-2"><i class="bi bi-calendar-check me-1 text-info"></i> Check booking schedule for available dates</p>` 
            : '';

        const imageCol = `
            <div class="col-lg-6">
                <img src="${room.image}" alt="${room.name}" class="img-fluid accommodation-img" style="width: 100%; height: 350px; object-fit: cover; border-radius: 12px;">
            </div>
        `;

        const contentCol = `
            <div class="col-lg-6">
                <div class="d-flex align-items-center mb-2">
                    ${statusBadge}
                    <span class="badge bg-primary">${room.category}</span>
                </div>
                <h2>${room.name}</h2>
                <p class="text-muted">Room ${room.room_id} • Up to ${room.occupancy} guests</p>
                ${bookingHint}
                <ul class="list-unstyled feature-list">
                    <li><i class="bi bi-people-fill me-2 text-primary"></i>${room.occupancy} Guest Capacity</li>
                    <li><i class="bi bi-tag-fill me-2 text-primary"></i>${room.category} Class</li>

                </ul>
                <p class="price-tag"><strong>Price:</strong> ₱${room.price} / night</p>
                <div class="d-flex gap-3">
                    <button class="btn btn-outline-primary btn-custom-outline" onclick="openRoomModal('${room.room_id}')">View Details</button>
                    <a href="/booking?room=${room.room_id}" class="btn btn-primary btn-custom-primary ${room.status !== 'available' ? 'disabled' : ''}">Reserve Now</a>
                </div>
            </div>
        `;

        return `
            <article class="accommodation-card" data-room="${room.room_id}">
                <div class="row g-4 align-items-center">
                    ${isEven ? imageCol + contentCol : contentCol + imageCol}
                </div>
            </article>
        `;
    }).join('');
}

async function openRoomModal(roomId) {
    try {
        const room = await apiGet(`/api/rooms/${roomId}`);

        document.getElementById('modalTitle').textContent = room.name;
        document.getElementById('modalPrice').textContent = `₱${room.price}`;
        document.getElementById('modalBadge').textContent = room.category;
        document.getElementById('modalImage').src = room.image;

        document.getElementById('modalDescription').textContent = 
            `${room.category} room for up to ${room.occupancy} guests. Room ${room.room_id}.`;

        const bookBtn = document.getElementById('modalBookBtn');
        if (room.status === 'available') {
            bookBtn.href = `/booking?room=${room.room_id}`;
            bookBtn.classList.remove('disabled');
        } else {
            bookBtn.href = '#';
            bookBtn.classList.add('disabled');
        }

        const featuresByCategory = {
            'Standard': [
                'Queen/twin beds',
                'Bathroom'
            ],
            'Cottage': [
                'Private cottage',
                'Garden deck',
                'Nature views'
            ]
        };

        const features = featuresByCategory[room.category] || featuresByCategory['Standard'];
        document.getElementById('modalFeatures').innerHTML = features.map(f => 
            `<li><i class="bi bi-check-circle-fill me-2 text-success"></i>${f}</li>`
        ).join('');

        const amenitiesByCategory = {
            'Cottage': [
                'Mountain view'
            ],
            'Standard': [
                'Air Conditioning',
                'Daily Housekeeping',
            ]
        };

        const amenities = amenitiesByCategory[room.category] || amenitiesByCategory['Standard'];
        document.getElementById('modalAmenities').innerHTML = amenities.map(a => 
            `<li><i class="bi bi-check-circle-fill me-2 text-success"></i>${a}</li>`
        ).join('');

        roomModal.show();
    } catch (err) {
        console.error('Error loading room details:', err);
    }
}

function setupSearch() {
    const searchInput = document.querySelector('.search-input');

    if (searchInput) {
        searchInput.addEventListener('input', function(e) {
            const searchTerm = e.target.value.toLowerCase();
            const cards = document.querySelectorAll('.accommodation-card');
            let visibleCount = 0;

            cards.forEach(card => {
                const title = card.querySelector('h2').textContent.toLowerCase();
                const description = card.querySelector('p').textContent.toLowerCase();
                const category = card.querySelector('.badge.bg-primary')?.textContent.toLowerCase() || '';

                if (title.includes(searchTerm) || description.includes(searchTerm) || category.includes(searchTerm)) {
                    card.style.display = 'block';
                    card.style.animation = 'fadeInUp 0.5s ease';
                    visibleCount++;
                } else {
                    card.style.display = 'none';
                }
            });

            const wrapper = document.querySelector('.accommodations-wrapper');
            let emptyState = document.getElementById('searchEmptyState');

            if (visibleCount === 0 && searchTerm !== '') {
                if (!emptyState) {
                    emptyState = document.createElement('div');
                    emptyState.id = 'searchEmptyState';
                    emptyState.className = 'search-empty-state';
                    emptyState.innerHTML = `
                        <i class="bi bi-search"></i>
                        <h4>No Rooms Found</h4>
                        <p>No rooms match your search for "<strong>${searchTerm}</strong>". Try different keywords.</p>
                        <button class="btn btn-primary" onclick="clearSearch()">Clear Search</button>
                    `;
                    wrapper.appendChild(emptyState);
                } else {
                    emptyState.querySelector('p').innerHTML = `No rooms match your search for "<strong>${searchTerm}</strong>". Try different keywords.`;
                    emptyState.style.display = 'block';
                }
            } else if (emptyState) {
                emptyState.style.display = 'none';
            }
        });
    }
}

function clearSearch() {
    const searchInput = document.querySelector('.search-input');
    if (searchInput) {
        searchInput.value = '';
        searchInput.dispatchEvent(new Event('input'));
        searchInput.focus();
    }
}