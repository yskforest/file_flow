// Glob Matching Utility
(function () {
    function globToRegex(glob) {
        // Escape special regex characters except * and ?
        let regexString = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');

        // Convert * to .*
        regexString = regexString.replace(/\*/g, '.*');

        // Convert ? to .
        regexString = regexString.replace(/\?/g, '.');

        // Anchor start and end
        return new RegExp('^' + regexString + '$', 'i'); // Case insensitive
    }

    FileFlow.utils.Glob = {
        globToRegex: globToRegex
    };
})();
