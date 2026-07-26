let currentFilter = 'all';
let diningSpots = [];
let facilities = [];

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
        const data = await apiGet('/api/amenities');
        diningSpots = data.dining || [];
        facilities = data.facilities || [];
        showAmenities();
    } catch (err) {
        console.error('Failed to load amenities:', err);
        document.getElementById('amenitiesContainer').innerHTML = `
            <div class="col-12 text-center py-5">
                <i class="bi bi-shop text-muted" style="font-size: 4rem;"></i>
                <h4 class="mt-3 text-muted">Failed to Load Amenities</h4>
                <p class="text-muted">Please try again later.</p>
            </div>
        `;
    }
}


function filterAmenities(category) {
    currentFilter = category;

    document.querySelectorAll('#amenitiesFilters button').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');

    showAmenities();
}

function searchAmenities() {
    showAmenities();
}


function showAmenities() {
    const container = document.getElementById('amenitiesContainer');
    const searchTerm = document.getElementById('amenitiesSearch').value.toLowerCase();

    let html = '';
    let hasResults = false;

    if (currentFilter === 'all' || currentFilter === 'dining') {
        let list = diningSpots;

        if (searchTerm) {
            list = list.filter(d => d.name.toLowerCase().includes(searchTerm));
        }

        if (list.length > 0) {
            hasResults = true;
            html += list.map(spot => `
                <div class="col-md-6 col-lg-4">
                    <div class="dining-card">
                        <span class="dining-tag-badge">${spot.tag || 'DINING'}</span>
                        <img src="${spot.image}" alt="${spot.name}">
                        <div class="dining-card-content">
                            <h4>${spot.name}</h4>
                            <p class="card-subtitle">Click to explore dining details</p>
                            <div class="d-flex gap-2">
                                <button class="btn btn-details-amenities w-100" onclick="showDiningModal('${spot.id}')">View Details</button>
                            </div>
                        </div>
                    </div>
                </div>
            `).join('');
        }
    }

    if (currentFilter === 'all' || currentFilter === 'facilities') {
        let list = facilities;

        if (searchTerm) {
            list = list.filter(f => f.name.toLowerCase().includes(searchTerm));
        }

        if (list.length > 0) {
            hasResults = true;
            html += list.map(facility => `
                <div class="col-md-6 col-lg-4">
                    <div class="facility-card">
                        <span class="facility-tag-badge">${facility.tag || 'FACILITY'}</span>
                        <img src="${facility.image}" alt="${facility.name}">
                        <div class="facility-card-content">
                            <h4>${facility.name}</h4>
                            <p class="card-subtitle">Click to explore facility details</p>
                            <div class="d-flex gap-2">
                                <button class="btn btn-details-amenities w-100" onclick="showFacilityModal('${facility.id}')">View Details</button>
                            </div>
                        </div>
                    </div>
                </div>
            `).join('');
        }
    }

    if (!hasResults) {
        html = `
            <div class="col-12 text-center py-5">
                <i class="bi bi-shop text-muted" style="font-size: 4rem;"></i>
                <h4 class="mt-3 text-muted">No items found</h4>
                <p class="text-muted">Try a different search or filter</p>
            </div>
        `;
    }

    container.innerHTML = html;
}


async function showDiningModal(diningId) {
    try {
        const spot = await apiGet(`/api/dining-spots/${diningId}`);

        document.getElementById('modalDiningImage').src = spot.image;
        document.getElementById('modalDiningName').textContent = spot.name;
        document.getElementById('modalDiningCategory').textContent = 'Dining';
        document.getElementById('modalDiningDescription').textContent = spot.description || 'No description available.';
        document.getElementById('modalDiningTag').textContent = spot.tag || 'DINING';
        
        // Update hours if available from API, else default
        document.getElementById('modalDiningHours').textContent = 
            spot.hours || spot.opening_hours || 'Open at : WED-FRI (9:00 AM – 5:00 PM)' + '\nand SAT-SUN (8:00 AM – 6:00 PM)';

        new bootstrap.Modal(document.getElementById('diningDetailsModal')).show();
    } catch (err) {
        console.error('Error loading dining details:', err);
    }
}

async function showFacilityModal(facilityId) {
    try {
        const facility = await apiGet(`/api/facilities/${facilityId}`);

        document.getElementById('modalFacilityImage').src = facility.image;
        document.getElementById('modalFacilityName').textContent = facility.name;
        document.getElementById('modalFacilityCategory').textContent = 'Facilities';
        document.getElementById('modalFacilityDescription').textContent = facility.description || 'No description available.';
        document.getElementById('modalFacilityTag').textContent = facility.tag || 'FACILITY';
        
        // Update hours if available from API, else default
        document.getElementById('modalFacilityHours').textContent = 
            facility.hours || facility.opening_hours || 'SWIMMINGPOOL : Open at (9AM - 10PM)'+'\n'+'\nKTV : Open 24 Hours';

        new bootstrap.Modal(document.getElementById('facilityDetailsModal')).show();
    } catch (err) {
        console.error('Error loading facility details:', err);
    }
}