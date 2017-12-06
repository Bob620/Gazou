const fs = require('fs'),
      crypto = require('crypto');

class Directory {
  constructor({uri=undefined, whitelist=[], minSize=0, maxSize=1000000000000}) {
    this.fileRegex = /.+(*)$/i;

    if (uri === undefined) {
      throw new Error('Undefined directory to index');
    }
    if (whitelist.length !== 0) {
      regex = '.+('
      for (let ext in whitelist) {
        regex += `(\.${ext})|`;
      }
      this.fileRegex = new RegExp(`${regex.substr(0, regex.length-1)})$`, 'i');
    }

    this.uri = uri;
    this.files = new Map();
    this.dirs = new Map();
    this.mixSize = minSize;
    this.maxSize = maxSize;
  }

  /**
   * Adds a new sub directory to be indexed
   * @param dirUri Relative URI to the directory
   */
  addSubDir(dirUri, dirStat) {

  }

  /**
   * Adds a file to the directory
   * @param fileUri Relative URI to the file
   */
  addFile(fileUri, fileStat) {
    if (this.fileRegex.test(fileUri)) {
      if (fileStat.size > this.minSize && fileStat.size < maxSize) {
        const file = new FileRef(`${this.uri}/${fileUri}`);//, {tags: [this.name]});

        const existingFile = this.files.get(file.hash);
        if (existingFile === undefined) {
          this.files.set(file.hash, file);
        } else {
          existingFile.addCopy(file.localCopies[0]);
        }
      }
    }
  }
}

class FileRef {
  constructor(uri, hash=undefined) {
    if (uri === undefined) {
      throw new Error('Undefined file created');
    }
    
    this.localCopies = [];
    this.remoteCopies = [];

    if (hash === undefined) {
      if (!uri.startsWith('http://') && !uri.startsWith('https://')) {
        const hash = crypto.createHash('md5');
        this.hash = hash.update(fs.readFileSync(uri)).digest('hex');
      } else {
        // Implement remote download and hashing
      }
    } else {
      this.hash = hash;
    }

    this.addCopy(uri);
  }

  /**
   * Adds a new copy to the file refrence
   * @param uri full URI of the file
   */
  addCopy(uri) {
    if (uri.startsWith('http://') || uri.startsWith('https://')) {
      if (this.localCopies.indexOf(uri) === -1) {
        this.localCopies.push(uri);
      }
    } else {
      if (this.remoteCopies.indexOf(uri) === -1) {
        this.remoteCopies.push(uri);
      }
    }
  }

  /**
   * Adds an Array of full URIs
   * @param copies Array of full file URIs to add
   */
  addCopies(copies) {
    copies.forEach((uri) => {
      this.addCopy(uri);
    });
  }
}