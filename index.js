const fs = require('fs'),
	  util = require('util'),
	  EventEmitter = require('events'),
	  crypto = require('crypto');

const program = require('commander');

const readdir = util.promisify(fs.readdir);
/*
program.version('1.0.0')
.option('-x, --max <n>', 'An integer of the max new images to upload', parseInt)
.option('-u, --update', 'Update old items')
.option('-p, --push', 'Push new items')
.arguments('[dir]')
.action((dir = '.', options) => {
	if (fs.statSync(dir).isDirectory() !== true) {
		throw 'Please provide a valid directory';
	}

	if (options.max === undefined) {
		options.max = 5000;
	}

	options.update = options.update !== undefined;
	options.push = options.push !== undefined;
});

program.parse(process.argv);
*/

