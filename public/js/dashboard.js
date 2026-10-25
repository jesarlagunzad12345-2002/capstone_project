
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
    revenueBookings: [],
    revenueBookingDate: '',
    revenueBookingsModal: null,

    init() {
        this.setCurrentDate();  
        this.loadStats();  
        this.loadRevenueLog();  
        this.revenueBookingsModal = new bootstrap.Modal(document.getElementById('revenueBookingsModal'));
        document.getElementById('revenueLog').addEventListener('click', event => {
            const item = event.target.closest('[data-revenue-date]');
            if (!item || event.target.closest('.delete-log-btn')) return;
            this.showRevenueBookings(item.dataset.revenueDate);
        });
        document.getElementById('revenueLog').addEventListener('keydown', event => {
            const item = event.target.closest('[data-revenue-date]');
            if (!item || event.target.closest('.delete-log-btn') || !['Enter', ' '].includes(event.key)) return;
            event.preventDefault();
            this.showRevenueBookings(item.dataset.revenueDate);
        });
        document.getElementById('revenueBookingRows').addEventListener('click', event => {
            const button = event.target.closest('[data-delete-revenue-booking]');
            if (button) this.deleteRevenueBooking(button.dataset.deleteRevenueBooking);
        });

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
                const dateKey = String(item.revenue_date).slice(0, 10);
                const date = new Date(`${dateKey}T00:00:00`);
                const dateStr = date.toLocaleDateString('en-US', {
                    year: 'numeric', month: 'short', day: 'numeric'
                });

                const isToday = this.isToday(date);
                const todayBadge = isToday ? 
                    '<span class="today-badge">TODAY</span>' : '';

                const amount = parseFloat(item.total_amount || 0);
                const guests = item.guest_count || 0;

                return `
                    <div class="revenue-log-item" data-revenue-date="${dateKey}" role="button" tabindex="0" aria-label="View bookings and payments for ${dateStr}">
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

    async showRevenueBookings(date) {
        const rows = document.getElementById('revenueBookingRows');
        this.revenueBookingDate = date;
        const dateLabel = new Date(`${date}T00:00:00`).toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric'
        });
        document.getElementById('revenueBookingsModalDate').textContent = dateLabel;
        rows.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4">Loading booking records...</td></tr>';
        this.revenueBookings = [];
        this.updateRevenueBookingSummary([]);
        this.revenueBookingsModal.show();

        try {
            const response = await fetch(`/api/dashboard/revenue-log/${encodeURIComponent(date)}/bookings`);
            const data = await response.json();
            if (!response.ok || !data.success || !Array.isArray(data.bookings)) {
                throw new Error(data.error || 'Could not load bookings for this revenue date.');
            }
            this.revenueBookings = data.bookings;
            this.updateRevenueBookingSummary(data.bookings);
            this.renderRevenueBookings();
        } catch (error) {
            console.error('Failed to load bookings for revenue date:', error);
            rows.innerHTML = `<tr><td colspan="9" class="text-center text-danger py-4">${this.escapeHtml(error.message)}</td></tr>`;
        }
    },

    renderRevenueBookings() {
        const rows = document.getElementById('revenueBookingRows');
        const bookings = this.revenueBookings;
        if (!bookings.length) {
            rows.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4">No booking records found for this date.</td></tr>';
            return;
        }
        rows.innerHTML = bookings.map(booking => {
            const source = booking.bookingSource === 'WALK_IN' ? 'Walk-in' : 'Online';
            const totalPrice = Number(booking.total_price) || 0;
            const amountPaid = Number(booking.amount_paid) || 0;
            const paymentStatus = totalPrice > 0 && amountPaid >= totalPrice
                ? 'Fully Paid'
                : source === 'Walk-in'
                    ? amountPaid > 0
                        ? 'Partially Paid'
                        : 'Unpaid'
                    : booking.payment_status || 'Not recorded';
            const bookingStatus = booking.status || 'Not recorded';
            const bookingStatusClass = String(bookingStatus).toLowerCase() === 'approved'
                ? 'bg-success-subtle text-success-emphasis'
                : 'bg-warning-subtle text-warning-emphasis';
            return `<tr>
                <td><div class="fw-semibold">${this.escapeHtml(booking.name || 'Guest')}</div><span class="badge ${source === 'Walk-in' ? 'bg-info-subtle text-info-emphasis' : 'bg-primary-subtle text-primary-emphasis'}">${source}</span></td>
                <td>${this.escapeHtml(booking.roomType || '—')}<div class="small text-muted">${Number(booking.people) || 0} guest(s)</div></td>
                <td><span class="badge ${bookingStatusClass}">${this.escapeHtml(bookingStatus)}</span></td>
                <td><span class="badge ${String(paymentStatus).toLowerCase().includes('paid') || String(paymentStatus).toLowerCase() === 'verified' ? 'bg-success-subtle text-success-emphasis' : 'bg-warning-subtle text-warning-emphasis'}">${this.escapeHtml(paymentStatus)}</span></td>
                <td class="text-uppercase">${this.escapeHtml(booking.payment_method || 'Not recorded')}</td>
                <td class="revenue-booking-money">₱${this.formatMoney(totalPrice)}</td>
                <td class="revenue-booking-money fw-semibold">₱${this.formatMoney(amountPaid)}</td>
                <td class="revenue-booking-money">₱${this.formatMoney(booking.balance)}</td>
                <td><button type="button" class="btn btn-sm btn-outline-danger" data-delete-revenue-booking="${encodeURIComponent(booking.id)}" aria-label="Delete ${this.escapeHtml(booking.name || 'booking')} from revenue records" title="Delete revenue record"><i class="bi bi-x-lg" aria-hidden="true"></i></button></td>
            </tr>`;
        }).join('');
    },

    updateRevenueBookingSummary(bookings) {
        const online = bookings.filter(booking => booking.bookingSource !== 'WALK_IN').length;
        const walkIn = bookings.length - online;
        const paid = bookings.reduce((sum, booking) => sum + (Number(booking.amount_paid) || 0), 0);
        document.getElementById('revenueSummaryBookings').textContent = String(bookings.length);
        document.getElementById('revenueSummaryOnline').textContent = String(online);
        document.getElementById('revenueSummaryWalkIn').textContent = String(walkIn);
        document.getElementById('revenueSummaryPaid').textContent = `₱${this.formatMoney(paid)}`;
    },

    escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, char => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[char]);
    },

    async deleteRevenueBooking(bookingId) {
        const confirmation = await showDashboardDialog({
            title: 'Delete this revenue booking record?',
            text: 'This removes it from the revenue history and adjusts that day’s revenue. It will not delete the booking record.',
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
        if (!confirmation.isConfirmed) return;

        try {
            const response = await fetch(
                `/api/dashboard/revenue-log/${encodeURIComponent(this.revenueBookingDate)}/bookings/${bookingId}`,
                { method: 'DELETE' }
            );
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Could not delete this revenue record.');
            }
            this.revenueBookings = this.revenueBookings.filter(booking => String(booking.id) !== decodeURIComponent(bookingId));
            this.updateRevenueBookingSummary(this.revenueBookings);
            this.renderRevenueBookings();
            this.loadStats();
            this.loadRevenueLog();
        } catch (error) {
            console.error('Failed to delete revenue booking record:', error);
            await showDashboardDialog({
                title: 'Could not delete record',
                text: error.message || 'Please try again.',
                icon: 'error',
                confirmButtonText: 'OK'
            });
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