const program = require('commander'),
      fs = require('fs'),
      util = require('util'),
      EventEmitter = require('events'),
      crypto = require('crypto');


const aws = require('aws-sdk'),
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
    discoveredTime = process.uptime() - startTime;
    console.log(`All images discovered in ${discoveredTime} sec\nchecking images for dups...`);
    let allImages = new Map();

    rootDirectory.images.forEach((newImage) => {
      if (allImages.has(newImage.uuid)) {
        allImages.get(newImage.uuid).occurance++;
      } else {
        const possibleImage = compareImages(allImages, newImage);
        if (possibleImage) {
          possibleImage.occurance++;
        } else {
          allImages.set(newImage.uuid, newImage);
        }
      }
    });

    let imageRace = [];

    rootDirectory.directories.forEach((dir) => {
      const tag = dir.name;
      dir.images.forEach((newImage) => {
        imageRace.push(new Promise((resolve, reject) => {
          const imageStartTime = process.uptime();
          const dupImage = compareImages(allImages, newImage);
          const returnTime = process.uptime() - imageStartTime;
          if (dupImage) {
            dupImage.occurance++;
            if (!dupImage.tags.includes(tag)) {
              dupImage.tags.push(tag);
            }
            if (dupImage.uri !== newImage.uri) {
              if (dupImage.sameImages.indexOf(newImage.uri) === -1) {
                dupImage.sameImages.push(newImage.uri);
              }
            }
          } else {
            allImages.set(newImage.uuid, newImage);
          }
          resolve(returnTime);
        }));
      });
    });

    Promise.all(imageRace)
    .then((imageTimes) => {
      let totalImages = 0;
      let copies = 0;
      allImages.forEach((image) => {
        totalImages += image.occurance;
        if (image.occurance > 1) {
          copies += image.occurance-1;
        }
      });

      let imageAvgTime = 0;
      imageTimes.forEach((time) => {
        imageAvgTime += time;
      });
      imageAvgTime /= 2;
      
      console.log(`Images compared in ${process.uptime() - discoveredTime} sec\n`);
      console.log(`Found ${copies} copies.\n`);
      console.log(`Total images found: ${totalImages}`);
      console.log(`Unique images found: ${allImages.size}\n`);
      console.log(`Average time per image compare: ${imageAvgTime} sec`);
      console.log(`Total time took: ${process.uptime() - startTime} sec\n`);
/*
      console.log('Comparing to local store...');
      fs.readFile(`${directory}/localStore.json`, (err, data) => {
        let localStore = new Map();
        if (err === null) {
          localStore = new Map(JSON.parse(data));
        }

        localStore.forEach((storedImage) => {

        });

        fs.writeFile(`${directory}/localStore.json`, JSON.stringify([...localStore]), (err) => {
          if (err) {
            console.log('Unable to update the local store');
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
  });
}

function compareImages(allImages, newImage) {
  let dupImage = false;
  allImages.forEach((existingImage) => {
    if (!dupImage) {
      if (existingImage.ext === newImage.ext) {
        if (existingImage.hash === newImage.hash) {
          const newImageBuffer = fs.readFileSync(newImage.uri);
          const existingImageBuffer = fs.readFileSync(existingImage.uri);
          if (existingImageBuffer.compare(newImageBuffer) === 0) {
            dupImage = existingImage;
          }
        }
      }
    }
  });
  return dupImage;
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
          this.addImageFile(itemName);
        } else if (itemStat.isDirectory()) {
          this.addDirectory(itemName);
        }
      });

      this.images.forEach((image) => {
        if (!image.ready) {
          image.once('ready', () => {
            this.processing.splice(this.processing.indexOf(image.uuid), 1);
            if (this.processing.length === 0) {
              this.emit('ready', this);
            }
          });
        } else {
          this.processing.splice(this.processing.indexOf(image.uuid), 1);
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

  addImageFile(name) {
    const uuid = intformat(flakeId.next(), 'dec')
    this.images.set(uuid, new ImageFile(name, `${this.uri}/${name}`, {tags: [this.name], uuid}));
    this.processing.push(uuid);
  }
}

class ImageFile extends EventEmitter{
  constructor(name, uri, {tags=[], uuid=intformat(flakeId.next(), 'dec')}) {
    super();

    this.name = name;
    this.sameImages = [];
    this.uri = uri;
    this.uuid = uuid;
    this.tags = tags;
    this.ext = name.substr(name.lastIndexOf('.')+1);
    this.occurance = 1;
    this.ready = false;

    const hash = crypto.createHash('md5');

    const input = fs.createReadStream(uri).on('readable', () => {
      const data = input.read();
      if (data) {
        hash.update(data);
      } else {
        this.hash = hash.digest('hex');
        this.ready = true;
        this.emit('ready');
      }
    });
  }
}

// Run program
program.parse(process.argv);