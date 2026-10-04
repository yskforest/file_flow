// FileFlow — State Store & Constants
// file:// 対応のため ES Modules 不使用・IIFE + グローバル名前空間を維持する。
(function () {
    'use strict';

    var Constants = {
        STORAGE_KEY: 'FileFlowSettings',
        SAMPLE_SIZE: 4096,
        BINARY_CHECK_SIZE: 512,
        LIST_CHUNK: 1000,
        FILTER_DEBOUNCE_MS: 300,
        ACTION_MODES: { MD: 'md', TXT: 'txt', DETECT: 'detect' },
        ACTION_IDS: { MD: '.md', TXT: '.txt', DETECT: 'detect' },
        VIEW_MODES: { TREE: 'tree', LIST: 'list' },
        DEFAULT_SETTINGS: { viewMode: 'tree', actionMode: 'md', excludeDots: true, showFullPath: true }
    };

    function resolveActionId(mode) {
        if (mode === Constants.ACTION_MODES.DETECT) return Constants.ACTION_IDS.DETECT;
        if (mode === Constants.ACTION_MODES.MD) return Constants.ACTION_IDS.MD;
        if (mode === Constants.ACTION_MODES.TXT) return Constants.ACTION_IDS.TXT;
        if (mode === Constants.ACTION_IDS.MD || mode === Constants.ACTION_IDS.TXT || mode === Constants.ACTION_IDS.DETECT) return mode;
        return null;
    }

    // --- Minimal pub/sub ---
    var listeners = {};
    function subscribe(event, callback) {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(callback);
        return function () {
            listeners[event] = listeners[event].filter(function (cb) { return cb !== callback; });
        };
    }
    function notify(event, val) {
        if (listeners[event]) listeners[event].slice().forEach(function (cb) {
            try { cb(val); } catch (e) { console.warn('FileFlow subscriber error:', e); }
        });
    }

    function createProxy(obj, onChange) {
        return new Proxy(obj, {
            set: function (target, key, value) {
                if (target[key] !== value) {
                    target[key] = value;
                    onChange(key, value);
                }
                return true;
            }
        });
    }

    function onSettingsChange(key, value) {
        notify('appSettings', appSettingsProxy);
        notify('setting:' + key, value);
    }

    var _currentRootEntries = [];
    var _appSettings = Object.assign({}, Constants.DEFAULT_SETTINGS);
    // entryMetadata は fullPath -> meta のプレーンオブジェクトを維持する
    // （既存テスト・永続化との互換のため Map 化しない）。
    // 更新は必ず updateMeta 経由で行い notify を保証する。
    var _entryMetadata = {};
    var _searchQuery = '';

    var appSettingsProxy = createProxy(_appSettings, onSettingsChange);

    function getMeta(path) {
        return _entryMetadata[path];
    }

    function updateMeta(path, patch) {
        if (!path) return null;
        var prev = _entryMetadata[path] || {};
        var next = Object.assign({}, prev, patch);
        _entryMetadata[path] = next;
        notify('entryMetadata', _entryMetadata);
        notify('metadata:' + path, next);
        return next;
    }

    function touchEntryMetadata() {
        notify('entryMetadata', _entryMetadata);
    }

    function resetMetadata() {
        _entryMetadata = {};
        notify('entryMetadata', _entryMetadata);
    }

    var state = {
        get currentRootEntries() { return _currentRootEntries; },
        set currentRootEntries(val) {
            _currentRootEntries = val || [];
            notify('currentRootEntries', _currentRootEntries);
        },
        get appSettings() { return appSettingsProxy; },
        set appSettings(val) {
            _appSettings = Object.assign({}, Constants.DEFAULT_SETTINGS, val);
            appSettingsProxy = createProxy(_appSettings, onSettingsChange);
            notify('appSettings', _appSettings);
        },
        get entryMetadata() { return _entryMetadata; },
        set entryMetadata(val) {
            _entryMetadata = val || {};
            notify('entryMetadata', _entryMetadata);
        },
        get searchQuery() { return _searchQuery; },
        set searchQuery(val) {
            _searchQuery = val || '';
            notify('searchQuery', _searchQuery);
        },
        subscribe: subscribe,
        getMeta: getMeta,
        updateMeta: updateMeta,
        touchEntryMetadata: touchEntryMetadata,
        resetMetadata: resetMetadata
    };

    window.FileFlow = window.FileFlow || {};
    window.FileFlow.state = state;
    window.FileFlow.constants = Constants;
    window.FileFlow.resolveActionId = resolveActionId;
    if (!window.FileFlow.actions) window.FileFlow.actions = {};
    if (!window.FileFlow.ui) window.FileFlow.ui = {};
    if (!window.FileFlow.utils) window.FileFlow.utils = {};
    if (!window.FileFlow.views) window.FileFlow.views = {};
})();
