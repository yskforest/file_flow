// Status UI
(function () {
    const statusToast = document.getElementById('status-toast');
    const statusText = document.getElementById('status-text');

    function showStatus(message) {
        if (statusText) statusText.textContent = message;
        if (statusToast) statusToast.classList.remove('hidden');
    }

    function hideStatus(delay = 0) {
        if (delay > 0) {
            setTimeout(() => {
                if (statusToast) statusToast.classList.add('hidden');
            }, delay);
        } else {
            if (statusToast) statusToast.classList.add('hidden');
        }
    }

    function showError(message) {
        showStatus("Error: " + message);
        setTimeout(() => hideStatus(), 3000);
    }

    FileFlow.ui.Status = {
        show: showStatus,
        hide: hideStatus,
        error: showError
    };
})();
