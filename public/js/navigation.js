const resortCoords = [10.7239, 122.3385]; 

function initPreviewMap() {
    const map = L.map('map', { 
        zoomControl: false,
        scrollWheelZoom: false,
        dragging: !L.Browser.mobile
    }).setView(resortCoords, 14);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    const marker = L.marker(resortCoords).addTo(map);
    marker.bindPopup("<b>KML Mountain Resort</b>").openPopup();

    L.control.zoom({ position: 'topright' }).addTo(map);
}

document.getElementById("goToLiveMap").addEventListener("click", () => {
    window.location.href = "/live-map"; 
});

initPreviewMap();