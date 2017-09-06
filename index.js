const fs = require('fs'),
      util = require('util'),
      EventEmitter = require('events'),
      crypto = require('crypto');

const aws = require('aws-sdk'),
      program = require('commander'),
      UploadStream = require('s3-upload-stream')(new aws.S3({apiVersion: '2006-03-01'})),
      FlakeId = require('flake-idgen'),
      intformat = require('biguint-format');

const readdir = util.promisify(fs.readdir),
      dynamodbWestTwo = new aws.DynamoDB({apiVersion: '2012-08-10', 'region': 'us-west-2'}),
      flakeId = new FlakeId();

program.version('0.0.1')
  .arguments('[dir]')
  .action((dir='.') => {
    if (fs.statSync(dir).isDirectory() !== true) {
      throw 'Please provide a valid directory';
    }

    processDir(dir);
  });

function processDir(directory) {
  console.log('Processing Directory...\n');
  const startTime = process.uptime();
  let discoveredTime;
  let rootDirectory = new Directory(directory);

  rootDirectory.once('ready', () => {
    discoveredTime = process.uptime();
    console.log(`All images discovered in ${discoveredTime - startTime} sec\nchecking images for dups...`);
    let allImages = new Map();

    rootDirectory.images.forEach((newImage) => {
      if (!allImages.has(image.hash)) {
        allImages.set(image.hash, image);
      } else {
        const originalImage = allImages.get(image.hash);
        originalImage.sameImages.push(image.uri);

        image.tags.forEach((tag) => {
          if (originalImage.tags.indexOf(tag) === -1) {
            originalImage.tags.push(tag);
          }
        });
      }
    });

    rootDirectory.directories.forEach((dir) => {
      dir.images.forEach((image) => {
        const imageStartTime = process.uptime();
        if (!allImages.has(image.hash)) {
          allImages.set(image.hash, image);
        } else {
          const originalImage = allImages.get(image.hash);
          originalImage.sameImages.push(image.uri);

          image.sameImages.forEach((imageUri) => {
            if (originalImage.sameImages.indexOf(imageUri) === -1) {
              originalImage.sameImages.push(imageUri);
            }
          });

          image.tags.forEach((tag) => {
            if (originalImage.tags.indexOf(tag) === -1) {
              originalImage.tags.push(tag);
            }
          });
        }
        const returnTime = process.uptime() - imageStartTime;
      });
    });

    let totalImages = 0;
    let copies = 0;

    allImages.forEach((image) => {
      const occurance = image.sameImages.length;
      totalImages += occurance + 1;
      if (occurance !== 0) {
        copies += occurance;
      }
    });

    console.log(`Images compared in ${process.uptime() - discoveredTime} sec\n`);
    console.log(`Found ${copies} copies.\n`);
    console.log(`Total images found: ${totalImages}`);
    console.log(`Unique images found: ${allImages.size}\n`);
    console.log(`Total time took: ${process.uptime() - startTime} sec\n`);

    console.log('Comparing to local store...');
    fs.readFile(`${directory}/localStore.json`, (err, data) => {
      let localStore;
      if (err === null && data !== null) {
        localStore = new Map(JSON.parse(data));
      } else {
        localStore = new Map();
      }
      
      let differences = new Map();
      updates = 0;

      allImages.forEach((image, hash) => {
        updates++;
        if (!localStore.has(hash)) {
          localStore.set(hash, image);
          differences.set(hash, image);
        } else {
          localImage = localStore.get(hash)
          image.uuid = localImage.uuid;
          localStore.set(hash, image);
        }
      });

      console.log(`${differences.size} new images since last update\n${updates} images updated`);

      fs.writeFile(`${directory}/localStore.json`, JSON.stringify([...localStore]), (err) => {
        if (err) {
          console.log('Unable to update the local store\n');
        } else {
          console.log('Local store updated');
        }
      });
    });
/*
    console.log('Uploading new images...');
    allImages.forEach((image) => {
      const uid = intformat(flakeId.next(), 'dec');
      const uploadStream = UploadStream.upload({Bucket: 'i.bobco.moe', Key: `${uid}.${image.ext}`, ACL: 'public-read'});

      uploadStream.once('uploaded', (details) => {
        const item = {
          uid: {S: uid},
          tags: {SS: image.tags},
          url: {S: `${uid}.${image.ext}`}
        }
    
        dynamodbWestTwo.putItem({
          Item: item,
          TableName: 'picturebase'
        }, (err, data) => {
          if (err) {
            console.log(err);
          } else {
            console.log(`Uploaded successful, UID: ${uid}`);
          }
        });
      });

      fs.createReadStream(copies[0].uri)
      .pipe(uploadStream);
    });*/
  });
}

class Directory extends EventEmitter {
  constructor(name, uri=name) {
    super();

    this.name = name;
    this.uri = uri;
    this.directories = new Map();
    this.images = new Map();
    this.processing = [];
    this.ready = false;

    // Process contents (directories and images only)
    readdir(uri).then((dirContents) => {
      dirContents.forEach((itemName) => {
        const imageRegex = /.+((\.png)|(\.gif)|(\.jpg)|(\.jpeg))$/gi;
        const itemStat = fs.statSync(`${this.uri}/${itemName}`);

        if (itemStat.isFile() && imageRegex.test(itemName)) {
          this.addImage(itemName);
        } else if (itemStat.isDirectory()) {
          this.addDirectory(itemName);
        }
      });

      this.directories.forEach((dir) => {
        if (!dir.ready) {
          dir.once('ready', (directory) => {
            this.processing.splice(this.processing.indexOf(directory.name), 1);
            if (this.processing.length === 0) {
              this.emit('ready', this);
            }
          });
        } else {
          this.processing.splice(this.processing.indexOf(dir.name), 1);
        }
      });

      if (this.processing.length === 0) {
        this.emit('ready', this);
      }
    }).catch((err) => {
      console.log(err);
    });

    this.once('ready', () => {
      this.ready = true;
    })
  }

  addDirectory(name) {
    this.directories.set(name, new Directory(name, `${this.uri}/${name}`));
    this.processing.push(name);
  }

  addImage(name) {
    const image = new Image(name, `${this.uri}/${name}`, {tags: [this.name]});
    if (!this.images.has(image.hash)) {
      this.images.set(image.hash, image);
    } else {
      this.images.get(image.hash).sameImages.push(image.uri);
    }
  }
}

class Image {
  constructor(name, uri, {tags=[], uuid=intformat(flakeId.next(), 'dec')}) {
    this.name = name;
    this.sameImages = [];
    this.uri = uri;
    this.uuid = uuid;
    this.tags = tags;

    const hash = crypto.createHash('md5');
    this.hash = hash.update(fs.readFileSync(uri)).digest('hex');
  }
}

// Run program
program.parse(process.argv);