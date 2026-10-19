
function showDashboardDialog(options) {
    return Swal.fire({
        buttonsStyling: false,
        customClass: {
            confirmButton: 'btn btn-dark px-4',
            cancelButton: 'btn btn-light px-4'
        },
        ...options
    });
}

const DashboardApp = {

    refreshInterval: 30000,

    init() {
        this.setCurrentDate();  
        this.loadStats();  
        this.loadRevenueLog();  

        setInterval(() => {
            this.loadStats();
            this.loadRevenueLog();
        }, this.refreshInterval);
    },

    setCurrentDate() {
        const options = { year: 'numeric', month: 'long', day: 'numeric' };
        const today = new Date().toLocaleDateString('en-US', options);
        document.getElementById('currentDate').textContent = 
            'Real-time operations for ' + today;
    },


    async loadStats() {
        try {

            const res = await fetch('/api/dashboard/stats');
            const data = await res.json();

            document.getElementById('dailyRevenue').textContent = 
                '₱' + this.formatMoney(data.dailyRevenue);

            document.getElementById('activeGuests').textContent = 
                data.activeGuests;

            document.getElementById('totalRevenue').textContent = 
                '₱' + this.formatMoney(data.totalRevenue);

            document.getElementById('totalGuestsAllTime').textContent = 
                (data.totalGuestsAllTime || 0) + ' total guests';

            this.renderBookings(data.recentOnlineBookings, data.recentWalkInBookings);

        } catch (err) {
            console.error('Failed to load stats:', err);
        }
    },

    async loadRevenueLog() {
        try {
            const res = await fetch('/api/dashboard/revenue-log');
            const data = await res.json();

            if (!data.log || data.log.length === 0) {
                document.getElementById('revenueLog').innerHTML = `
                    <div class="empty-state">
                        <i class="bi bi-journal-x fs-1 mb-2 d-block"></i>
                        No revenue records yet
                    </div>
                `;
                document.getElementById('logCount').textContent = '0 entries';
                return;
            }

            // Count how many entries
            document.getElementById('logCount').textContent = 
                data.log.length + ' entries';

            // Build the HTML list
            const html = data.log.map(item => {
                const date = new Date(item.revenue_date);
                const dateStr = date.toLocaleDateString('en-US', {
                    year: 'numeric', month: 'short', day: 'numeric'
                });

                const isToday = this.isToday(date);
                const todayBadge = isToday ? 
                    '<span class="today-badge">TODAY</span>' : '';

                const amount = parseFloat(item.total_amount || 0);
                const guests = item.guest_count || 0;

                return `
                    <div class="revenue-log-item">
                        <div>
                            <div class="log-date">
                                ${dateStr}${todayBadge}
                            </div>
                            <div class="log-guests">
                                <i class="bi bi-people-fill me-1"></i>${guests} guests
                            </div>
                        </div>
                        <div class="d-flex align-items-center gap-2">
                            <span class="log-amount">
                                ₱${this.formatMoney(amount)}
                            </span>
                            <button class="delete-log-btn" 
                                    onclick="DashboardApp.deleteLog(${item.id})"
                                    title="Delete this record">
                                <i class="bi bi-trash3"></i>
                            </button>
                        </div>
                    </div>
                `;
            }).join('');

            document.getElementById('revenueLog').innerHTML = html;

        } catch (err) {
            console.error('Failed to load revenue log:', err);
        }
    },

    async deleteLog(id) {
        const confirmation = await showDashboardDialog({
            title: 'Delete revenue record?',
            text: 'This will reduce the Total Revenue.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Delete record',
            cancelButtonText: 'Keep record',
            reverseButtons: true,
            customClass: {
                confirmButton: 'btn btn-danger px-4',
                cancelButton: 'btn btn-light px-4'
            }
        });
        if (!confirmation.isConfirmed) {
            return;
        }

        try {
            const res = await fetch(`/api/dashboard/revenue-log/${id}`, {
                method: 'DELETE'
            });
            const data = await res.json();

            if (data.success) {
                this.loadStats();
                this.loadRevenueLog();
            } else {
                await showDashboardDialog({
                    title: 'Could not delete record',
                    text: data.message || 'Unknown error',
                    icon: 'error',
                    confirmButtonText: 'OK'
                });
            }
        } catch (err) {
            console.error('Delete error:', err);
            await showDashboardDialog({
                title: 'Error deleting record',
                text: 'Please try again.',
                icon: 'error',
                confirmButtonText: 'OK'
            });
        }
    },

    async resetRevenue() {
        const confirmation = await showDashboardDialog({
            title: 'Reset daily revenue?',
            text: 'Daily revenue will be set to ₱0.00.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Reset revenue',
            cancelButtonText: 'Cancel',
            reverseButtons: true
        });
        if (!confirmation.isConfirmed) return;

        try {
            const res = await fetch('/api/dashboard/reset-revenue', {
                method: 'POST'
            });
            const data = await res.json();

            if (data.success) {
                await showDashboardDialog({
                    title: 'Revenue reset',
                    text: 'Daily revenue is now ₱0.00.',
                    icon: 'success',
                    confirmButtonText: 'Done'
                });
                this.loadStats();
                this.loadRevenueLog();
                document.getElementById('lastReset').textContent = 'Reset just now';
            }
        } catch (err) {
            console.error('Reset error:', err);
            await showDashboardDialog({
                title: 'Error resetting revenue',
                text: 'Please try again.',
                icon: 'error',
                confirmButtonText: 'OK'
            });
        }
    },

    renderBookings(onlineBookings, walkInBookings) {
        const renderRows = (bookings, showPaymentMethod = false) => {
            if (!bookings || bookings.length === 0) {
                return `<tr><td colspan="${showPaymentMethod ? 4 : 3}" class="text-center py-4 text-muted">No bookings yet</td></tr>`;
            }

            return bookings.map(booking => {
            const initials = booking.name
                .split(' ')
                .map(n => n[0])
                .join('')
                .substring(0, 2)
                .toUpperCase();

            // Color code the status
            let statusClass, statusText;
            if (booking.status === 'approved') {
                statusClass = 'bg-success bg-opacity-10 text-success';
                statusText = 'Approved';
            } else if (booking.status === 'pending') {
                statusClass = 'bg-warning bg-opacity-10 text-warning';
                statusText = 'Pending';
            } else {
                statusClass = 'bg-secondary bg-opacity-10 text-secondary';
                statusText = booking.status;
            }

            const paymentMethodMarkup = showPaymentMethod
                ? `<td class="text-center"><span class="small fw-semibold text-uppercase">${booking.payment_method || 'Not recorded'}</span></td>`
                : '';

            return `
                <tr>
                    <td class="ps-3">
                        <div class="d-flex align-items-center">
                            <div class="bg-light rounded-3 p-2 fw-bold me-2 text-dark small">
                                ${initials}
                            </div>
                            <div class="text-truncate">
                                <div class="fw-bold small">${booking.name}</div>
                                <div class="text-muted" style="font-size: 0.7rem;">
                                    ${booking.roomType}
                                </div>
                            </div>
                        </div>
                    </td>
                    <td class="small text-center">${booking.people} guest(s)</td>
                    <td class="text-center">
                        <span class="status-tag ${statusClass}">${statusText}</span>
                    </td>
                    ${paymentMethodMarkup}
                </tr>
            `;
            }).join('');
        };

        document.getElementById('onlineBookingsTable').innerHTML = renderRows(onlineBookings);
        document.getElementById('walkInBookingsTable').innerHTML = renderRows(walkInBookings, true);
    },

    isToday(date) {
        const today = new Date();
        return date.getDate() === today.getDate() &&
               date.getMonth() === today.getMonth() &&
               date.getFullYear() === today.getFullYear();
    },

    formatMoney(num) {
        return parseFloat(num || 0).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }
};

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('active');
}

document.addEventListener('DOMContentLoaded', () => {
    DashboardApp.init();
});