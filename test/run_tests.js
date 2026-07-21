// FileFlow Test Suite — Node.js CLI Test Runner
const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log("Setting up Node.js test environment...");

// Mock basic browser global environment
global.window = global;
global.FileFlow = {};

// Simple DOM Mock
global.document = {
    getElementById(id) {
        return {
            innerHTML: '',
            appendChild() {},
            removeChild() {},
            children: [],
            classList: {
                add() {},
                remove() {},
                contains() { return false; }
            }
        };
    },
    createElement(tag) {
        return {
            style: {},
            textContent: "",
            className: "",
            appendChild() {},
            removeChild() {},
            after() {}
        };
    }
};

// Mock JSZip
global.JSZip = function() {
    return {
        file() {},
        folder() { return this; },
        generateAsync() { return Promise.resolve(new Uint8Array([])); }
    };
};

// Loader function to execute scripts in the global context
function loadScript(relativeScriptPath) {
    const absolutePath = path.resolve(__dirname, relativeScriptPath);
    const code = fs.readFileSync(absolutePath, 'utf8');
    vm.runInThisContext(code, { filename: absolutePath });
}

// Load core FileFlow scripts
loadScript('../js/utils.js');
loadScript('../js/actions.js');

// Load Test Cases and runner
const TestRunner = require('./test_runner.js');

// Execute Tests
console.log("Executing test cases...");
TestRunner.run(
    (total) => {
        console.log(`Total tests registered: ${total}\n`);
    },
    (name, isPass, error) => {
        if (isPass) {
            console.log(`  [ PASS ] ${name}`);
        } else {
            console.log(`  [ FAIL ] ${name}`);
            if (error) {
                console.error(`           Error: ${error.message}`);
                if (error.stack) {
                    // Print stack indented
                    console.error(error.stack.split('\n').map(line => `           ${line}`).join('\n'));
                }
            }
        }
    },
    (passed, failed, total) => {
        console.log("\n============================================");
        console.log(`Tests completed: ${passed}/${total} passed.`);
        if (failed > 0) {
            console.log(`Status: FAILED (${failed} failed)`);
            process.exit(1);
        } else {
            console.log("Status: SUCCESS");
            process.exit(0);
        }
    }
).catch(err => {
    console.error("Fatal error during test run:", err);
    process.exit(1);
});
