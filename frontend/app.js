// Configuration
const CONFIG = {
  API_BASE_URL: 'http://localhost:8000',
  BANGALORE_CENTER: [12.9716, 77.5946],
  DEFAULT_ZOOM: 11
};

let map;
let currentMarker = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', function () {
  initMap();
  attachEventListeners();
  console.log('Geo-Representative Lookup initialized');
});

// Initialize Leaflet map
function initMap() {
  map = L.map('map').setView(CONFIG.BANGALORE_CENTER, CONFIG.DEFAULT_ZOOM);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 18
  }).addTo(map);

  map.on('click', handleMapClick);
  console.log('Map initialized');
}

// Attach event listeners
function attachEventListeners() {
  document.getElementById('lookup-btn').addEventListener('click', handleManualLookup);

  document.getElementById('latitude').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') handleManualLookup();
  });

  document.getElementById('longitude').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') handleManualLookup();
  });
}

// Handle map click
function handleMapClick(e) {
  const lat = e.latlng.lat;
  const lon = e.latlng.lng;

  console.log(`Map clicked: ${lat}, ${lon}`);

  // Update marker
  if (currentMarker) {
    currentMarker.setLatLng(e.latlng);
  } else {
    currentMarker = L.marker(e.latlng).addTo(map);
  }

  // Update inputs
  document.getElementById('latitude').value = lat.toFixed(4);
  document.getElementById('longitude').value = lon.toFixed(4);

  // Lookup
  lookupRepresentatives(lat, lon);
}

// Handle manual lookup
function handleManualLookup() {
  const lat = parseFloat(document.getElementById('latitude').value);
  const lon = parseFloat(document.getElementById('longitude').value);

  if (isNaN(lat) || isNaN(lon)) {
    showError('Please enter valid coordinates');
    return;
  }

  if (lat < 12.7 || lat > 13.2 || lon < 77.3 || lon > 77.9) {
    showError('Coordinates must be within Bangalore (Lat: 12.7-13.2, Lon: 77.3-77.9)');
    return;
  }

  // Update marker
  const latlng = L.latLng(lat, lon);
  if (currentMarker) {
    currentMarker.setLatLng(latlng);
  } else {
    currentMarker = L.marker(latlng).addTo(map);
  }

  map.setView(latlng, CONFIG.DEFAULT_ZOOM);
  lookupRepresentatives(lat, lon);
}

// Call API to lookup representatives
async function lookupRepresentatives(lat, lon) {
  console.log(`Looking up: ${lat}, ${lon}`);

  showLoading();
  hideError();
  hideResults();

  try {
    const response = await fetch(
      `${CONFIG.API_BASE_URL}/api/v1/lookup?lat=${lat}&lon=${lon}`
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail?.message || 'Lookup failed');
    }

    const data = await response.json();
    console.log('Response:', data);
    displayResults(data);

  } catch (error) {
    console.error('Error:', error);
    showError(error.message || 'Failed to connect to server. Make sure backend is running on port 8000.');
  } finally {
    hideLoading();
  }
}

// Display results
function displayResults(data) {
  document.getElementById('coords').textContent =
    `Location: ${data.latitude.toFixed(4)}°N, ${data.longitude.toFixed(4)}°E`;

  // Display MP
  if (data.mp) {
    displayRepresentative('mp', data.mp);
    document.getElementById('mp-card').style.display = 'block';
  } else {
    document.getElementById('mp-card').style.display = 'none';
  }

  // Display MLA
  if (data.mla) {
    displayRepresentative('mla', data.mla);
    document.getElementById('mla-card').style.display = 'block';
  } else {
    document.getElementById('mla-card').style.display = 'none';
  }

  showResults();

  // Add popup to marker
  if (currentMarker) {
    const popupContent = `
          <strong>Your Representatives</strong><br>
          <strong>MP:</strong> ${data.mp?.name || 'Not found'}<br>
          <strong>MLA:</strong> ${data.mla?.name || 'Not found'}
      `;
    currentMarker.bindPopup(popupContent).openPopup();
  }
}

// Display individual representative
function displayRepresentative(type, rep) {
  document.getElementById(`${type}-name`).textContent = rep.name;

  const partyEl = document.getElementById(`${type}-party`);
  partyEl.textContent = rep.party;
  partyEl.style.background = getPartyColor(rep.party);

  let constituencyText = rep.constituency;
  if (rep.constituency_number) {
    constituencyText += ` (No. ${rep.constituency_number})`;
  }
  document.getElementById(`${type}-constituency`).textContent = constituencyText;

  // Contact info
  const contactDiv = document.getElementById(`${type}-contact`);
  let contactHTML = '';

  if (rep.contact) {
    contactHTML += `<p>📞 ${rep.contact}</p>`;
  }
  if (rep.email) {
    contactHTML += `<p>✉️ <a href="mailto:${rep.email}">${rep.email}</a></p>`;
  }
  if (rep.office_address) {
    contactHTML += `<p>🏢 ${rep.office_address}</p>`;
  }

  contactDiv.innerHTML = contactHTML;
  contactDiv.style.display = contactHTML ? 'block' : 'none';
}

// Get party color
function getPartyColor(party) {
  const colors = {
    'BJP': '#FF9933',
    'INC': '#19AAED',
    'JD(S)': '#02865A',
    'AAP': '#0E4DA0',
    'N/A': '#6c757d'
  };
  return colors[party] || '#667eea';
}

// UI state functions
function showLoading() {
  document.getElementById('loading').classList.remove('hidden');
}

function hideLoading() {
  document.getElementById('loading').classList.add('hidden');
}

function showResults() {
  document.getElementById('results').classList.remove('hidden');
}

function hideResults() {
  document.getElementById('results').classList.add('hidden');
}

function showError(message) {
  const errorEl = document.getElementById('error');
  errorEl.textContent = '❌ ' + message;
  errorEl.classList.remove('hidden');
}

function hideError() {
  document.getElementById('error').classList.add('hidden');
}

// Check backend health
async function checkBackend() {
  try {
    const response = await fetch(`${CONFIG.API_BASE_URL}/health`);
    if (response.ok) {
      console.log('✓ Backend is running');
      return true;
    }
    return false;
  } catch (error) {
    console.warn('⚠️ Backend may not be running');
    return false;
  }
}

checkBackend();
// ```

// ---

// ## 🚀 How to Use These Files

// 1. **Create the folder structure:**
// ```
// your_project /
// ├── backend /
// │   ├── app /
// │   └── data /
// └── frontend /