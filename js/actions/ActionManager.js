// Action Architecture
(function () {

    // Base Action Class
    class BaseAction {
        constructor(id, label) {
            this.id = id;
            this.label = label;
        }

        // Returns true if this action applies to the given file entry
        shouldApply(entry, filename) {
            return true;
        }

        // Execute the action on a single item (DOM element + Entry)
        async execute(itemDiv, entry) {
            throw new Error("Execute method not implemented");
        }
    }

    // Action Manager
    const registry = {};

    function register(action) {
        registry[action.id] = action;
        console.log(`Action registered: ${action.id}`);
    }

    function getAction(id) {
        return registry[id];
    }

    FileFlow.actions.BaseAction = BaseAction;
    FileFlow.actions.ActionManager = {
        register: register,
        getAction: getAction
    };

})();
