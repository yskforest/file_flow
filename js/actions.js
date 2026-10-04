// FileFlow — Action System (DOM-free, pure domain logic)
// 描画への反映は ui.Render.applyActionResult に委譲する。
(function () {
    'use strict';

    var State = window.FileFlow.state;
    var resolveActionId = window.FileFlow.resolveActionId;
    var C = window.FileFlow.constants;

    function endsWithExt(name, ext) {
        return String(name || '').toLowerCase().endsWith(String(ext || '').toLowerCase());
    }

    function normalizeExecuteArgs(a, b) {
        // 新: execute(entry) / 旧: execute(itemDiv, entry) の両対応。
        if (b && (b.isFile !== undefined || b.isDirectory !== undefined || b.name !== undefined)) return b;
        if (a && (a.isFile !== undefined || a.isDirectory !== undefined)) return a;
        return b || a;
    }

    class BaseAction {
        constructor(id, label) { this.id = id; this.label = label; }
        shouldApply(entry) { return !!entry && !entry.isDirectory; }
        execute() { return Promise.reject(new Error('Not implemented')); }
    }

    const registry = {};
    const ActionManager = {
        register: function (action) { registry[action.id] = action; },
        getAction: function (id) { return registry[id]; },
        resolve: function (modeOrId) { return registry[resolveActionId(modeOrId)]; },
        list: function () { return Object.values(registry); }
    };

    class RenameAction extends BaseAction {
        constructor(ext) {
            super(ext, 'Add ' + ext);
            this.ext = ext;
        }
        shouldApply(entry) {
            return !!entry && !entry.isDirectory && !endsWithExt(entry.name, this.ext);
        }
        async execute(itemDivOrEntry, maybeEntry) {
            var entry = normalizeExecuteArgs(itemDivOrEntry, maybeEntry);
            if (!entry || entry.isDirectory) return { applied: false, reason: 'directory' };
            if (endsWithExt(entry.name, this.ext)) return { applied: false, reason: 'already-has-ext' };
            var newName = entry.name + this.ext;
            var key = entry.fullPath || entry.name;
            State.updateMeta(key, { newFilename: newName });
            return { applied: true, newName: newName, key: key };
        }
    }

    class DetectAction extends BaseAction {
        constructor() { super(C.ACTION_IDS.DETECT, 'Detect Info'); }
        shouldApply(entry) { return !!entry && !entry.isDirectory; }
        async execute(itemDivOrEntry, maybeEntry) {
            var entry = normalizeExecuteArgs(itemDivOrEntry, maybeEntry);
            if (!entry || entry.isDirectory) return { applied: false, reason: 'directory' };
            var file = await new Promise(function (res, rej) {
                try { entry.file(res, rej); } catch (e) { rej(e); }
            });
            var info = await window.FileFlow.utils.Detect.detectFileInfo(file);
            var key = entry.fullPath || entry.name;
            State.updateMeta(key, { detectionInfo: { encoding: info.encoding, eol: info.eol } });
            var prev = State.getMeta(key) || {};
            if (prev.encoding === undefined) State.updateMeta(key, { encoding: info.encoding, eol: info.eol });
            return { applied: true, key: key, encoding: info.encoding, eol: info.eol };
        }
    }

    ActionManager.register(new RenameAction(C.ACTION_IDS.MD));
    ActionManager.register(new RenameAction(C.ACTION_IDS.TXT));
    ActionManager.register(new DetectAction());

    window.FileFlow.actions = { BaseAction, ActionManager, RenameAction, DetectAction };
})();
