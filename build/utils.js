"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Promise = require("bluebird");
const klaw = require("klaw");
/**
 * Given a docker 'arrow message' containing a sha representing
 * a layer, extract the sha digest. If the string passed in is not
 * an arrow message, undefined will be returned.
 *
 * @param {string} message
 *	The build message to parse
 * @returns {string}
 *	Either the sha string, or undefined
 */
exports.extractLayer = (message) => {
    const extract = extractArrowMessage(message);
    if (extract !== undefined) {
        const shaRegex = /([a-f0-9]{12}[a-f0-9]*)/g;
        const match = shaRegex.exec(extract);
        if (match) {
            return match[1];
        }
    }
    return;
};
const extractArrowMessage = (message) => {
    const arrowTest = /^\s*-+>\s*(.+)/;
    const match = arrowTest.exec(message);
    if (match) {
        return match[1];
    }
    else {
        return;
    }
};
/**
 * Go through an entire directory, splitting the entries out
 * into a list of paths to work through.
 */
exports.directoryToFiles = (dirPath) => {
    return new Promise((resolve, reject) => {
        const files = [];
        // Walk the directory
        klaw(dirPath)
            .on('data', (item) => {
            if (!item.stats.isDirectory()) {
                files.push(item.path);
            }
        })
            .on('end', () => {
            resolve(files);
        })
            .on('error', reject);
    });
};

//# sourceMappingURL=utils.js.map
