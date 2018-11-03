const crypto = require('crypto');
const fs = require('fs');
const readline =  require('readline');

const config = require('./config/config');

const Gazou = require('./util/wsClient');
const gazou = new Gazou(config.test.url);

const fileLocation = './test/Screenshot_20170117-014953.png';
let type = fileLocation.split('.');
type = type[type.length-1];

gazou.connect().then(async () => {
	console.log('Connected');
	try {
		let hash = crypto.createHash('sha1');
		hash.update(fs.readFileSync(fileLocation));
		hash = hash.digest('hex');

		await gazou.authInit(config.test.user);

		const token= await new Promise(resolve => {
			const rl = readline.createInterface({
				input: process.stdin,
				output: process.stdout
			});

			rl.question('Token: ', token => {
				rl.close();
				resolve(token);
			});
		});

		await gazou.authSubmit(token);

		const {uuid: testUuid, uploadLink} = await gazou.upload(hash, type, 'someone', ['gab', 'face', 'anime']);

		console.log(`${testUuid} -- ${uploadLink}`);

		console.log(await gazou.uploadImage(uploadLink, fileLocation));

		let initMeta = await gazou.get(testUuid);
		initMeta = initMeta[Object.keys(initMeta)[0]];

		console.log(initMeta);

		console.log('\nsearchTags - Single Tag');
		let uuids = await gazou.searchTags([initMeta.tags[0]]);
		console.log(uuids);
		let images = await gazou.get(uuids);
		console.log(images);

		console.log('\nsearchTags - Multi-Tag');
		uuids = await gazou.searchTags(initMeta.tags);
		console.log(uuids);
		images = await gazou.get(uuids);
		console.log(images);

		console.log('\nsearchArtist');
		uuids = await gazou.searchArtist(initMeta.artist);
		console.log(uuids);
		images = await gazou.get(uuids);
		console.log(images);

		console.log('\nPushing updates...');
		console.log(await gazou.update(uuids[0], {
			artist: images[initMeta.uuid].artist+'1'
		}));

		console.log('\nsearchDateModified - Original');
		uuids = await gazou.searchDateModified(initMeta.dateModified, initMeta.dateModified);
		console.log(uuids);
		images = await gazou.get(uuids);
		console.log(images);

		console.log('\nsearchDateAdded');
		uuids = await gazou.searchDateAdded(initMeta.dateAdded, initMeta.dateAdded);
		console.log(uuids);
		images = await gazou.get(uuids);
		console.log(images);

		console.log(`\nsearchDateModified - ${images[initMeta.uuid].dateModified}`);
		uuids = await gazou.searchDateModified(images[initMeta.uuid].dateModified, images[initMeta.uuid].dateModified);
		console.log(uuids);
		images = await gazou.get(uuids);
		console.log(images);

		console.log(`\nsearchRandomByArtist - ${images[initMeta.uuid].artist}`);
		uuids = await gazou.searchRandomByArtist(images[initMeta.uuid].artist);
		console.log(uuids);

		console.log(`\nsearchRandomByTags - ${images[initMeta.uuid].tags[0]}`);
		uuids = await gazou.searchRandomByTags([images[initMeta.uuid].tags[0]]);
		console.log(uuids);

		console.log(`\ngetArtist - ${initMeta.artist}`);
		let artist = await gazou.getArtist(initMeta.artist);
		console.log(artist);

		console.log('\n Removing image');
		console.log(await gazou.remove(testUuid));
	} catch(err) {
		console.log('\nError:');
		console.log(err);
	}

	console.log('');
	console.log(await gazou.disconnect());

	process.exit(0);
});
