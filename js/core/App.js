// Core Application Namespace
window.FileFlow = {
    state: {
        currentRootEntries: [],
        appSettings: {
            viewMode: 'tree', // 'tree' or 'list'
            actionMode: 'md',   // 'md', 'txt', 'detect'
            excludeDots: true
        },
        searchQuery: ''
    },
    actions: {}, // Registry for actions
    ui: {},      // UI Helpers
    utils: {}    // Utilities
};
