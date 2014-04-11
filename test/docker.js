var dockerMock = require('../lib/index');
var async = require('async');
var request = require('request');
var tar = require('tar-stream');
var zlib = require('zlib');
dockerMock.listen(5354);

var docker = require('dockerode')({host: 'http://localhost', port: 5354});

describe('containers', function () {
  it('should create and delete a container', function (done) {
    async.waterfall([
      docker.createContainer.bind(docker, {}),
      function (container, cb) {
        container.remove(cb);
      }
    ], done);
  });
  it('should list all the containers when there are none', function (done) {
    docker.listContainers(function (err, containers) {
      if (err) return done(err);
      containers.length.should.equal(0);
      done();
    });
  });
  describe('interactions', function () {
    var container;
    beforeEach(function (done) {
      docker.createContainer({}, function (err, c) {
        if (err) return done(err);
        container = c;
        done();
      });
    });
    afterEach(function (done) {
      container.remove(done);
    });
    it('should list all the containers', function (done) {
      docker.listContainers(function (err, containers) {
        if (err) return done(err);
        containers.length.should.equal(1);
        containers[0].Id.should.equal(container.id);
        done();
      });
    });
    it('should give us information about it', function (done) {
      container.inspect(function (err, data) {
        if (err) return done(err);
        data.Id.should.equal(container.id);
        done();
      });
    });
    it('should error on an unknown container', function (done) {
      docker.getContainer('nope').inspect(function (err, data) {
        if (err) done();
        else done('should have return a 404');
      });
    });
    it('should be able to commit a container to an image', function (done) {
      async.waterfall([
        function (cb) {
          container.commit({
            tag: 'committedContainer'
          }, cb);
        },
        function (imageData, cb) {
          var image = docker.getImage('committedContainer');
          image.inspect(function (err, data) {
            if (err) return cb(err);
            data.id.indexOf(imageData.Id).should.equal(0);
            cb(null, image);
          });
        },
        function (image, cb) {
          image.remove(cb);
        }
      ], done);
    });
    it('should be able to start it', function (done) {
      container.start(function (err) {
        if (err) return done(err);
        container.inspect(function (err, data) {
          if (err) return done(err);
          data.State.Running.should.equal.true;
          done();
        });
      });
    });
    it('should should not start twice', function (done) {
      async.series([
        container.start.bind(container),
        container.start.bind(container)
      ], function (err) {
        if (!err) return done('should not have started second time');
        container.inspect(function (err, data) {
          if (err) return done(err);
          data.State.Running.should.equal.true;
          done();
        });
      });
    });
    it('should be able to stop it', function (done) {
      async.series([
        container.start.bind(container),
        container.stop.bind(container)
      ], function (err) {
        if (err) return done(err);
        container.inspect(function (err, data) {
          if (err) return done(err);
          data.State.Running.should.equal.false;
          done();
        });
      });
    });
    it('should be able to stop and wait for it to stop', function (done) {
      async.series([
        container.start.bind(container),
        container.wait.bind(container)
      ], function (err) {
        if (err) return done(err);
        container.inspect(function (err, data) {
          if (err) return done(err);
          data.State.Running.should.equal.false;
          done();
        });
      });
    });
    it('should noop if stopped twice', function (done) {
      async.series([
        container.start.bind(container),
        container.stop.bind(container),
        container.stop.bind(container)
      ], function (err) {
        if (err) return done(err);
        container.inspect(function (err, data) {
          if (err) return done(err);
          data.State.Running.should.equal.false;
          done();
        });
      });
    });
    it('should be able to kill it', function (done) {
      async.series([
        container.start.bind(container),
        container.kill.bind(container)
      ], function (err) {
        if (err) return done(err);
        container.inspect(function (err, data) {
          if (err) return done(err);
          data.State.Running.should.equal.false;
          done();
        });
      });
    });
    it('should be able to restart it', function (done) {
      async.series([
        container.start.bind(container),
        container.restart.bind(container)
      ], function (err) {
        if (err) return done(err);
        container.inspect(function (err, data) {
          if (err) return done(err);
          data.State.Running.should.equal.true;
          done();
        });
      });
    });
  });
});

describe('images', function () {
  it('should be able to build images, and delete it', function (done) {
    var pack = tar.pack();
    pack.entry({ name: './', type: 'directory' });
    pack.entry({ name: './Dockerfile' }, 'FROM ubuntu\nADD ./src /root/src\n');
    pack.entry({ name: './src', type: 'directory' });
    pack.entry({ name: './src/index.js' }, 'console.log(\'hello\');\n');
    pack.finalize();
    var image = docker.getImage('buildTest');
    docker.buildImage(pack, { t: 'buildTest' }, watchBuild(image, done));
  });
  it('should emulate a build failure', function (done) {
    var pack = tar.pack();
    pack.entry({ name: './', type: 'directory' });
    pack.entry({ name: './Dockerfile' }, 'FROM ubuntu\nADD ./src /root/src\n');
    pack.entry({ name: './src', type: 'directory' });
    pack.entry({ name: './src/index.js' }, 'console.log(\'hello\');\n');
    pack.finalize();
    docker.buildImage(pack, { t: 'doomedImage', fail: true }, watchBuildFail(done));
  });
  it('should be able to build images with namespace/repository, and delete it', function (done) {
    var pack = tar.pack();
    pack.entry({ name: './', type: 'directory' });
    pack.entry({ name: './Dockerfile' }, 'FROM ubuntu\nADD ./src /root/src\n');
    pack.entry({ name: './src', type: 'directory' });
    pack.entry({ name: './src/index.js' }, 'console.log(\'hello\');\n');
    pack.finalize();
    var image = docker.getImage('docker-mock/buildTest');
    docker.buildImage(pack, { t: 'docker-mock/buildTest' }, watchBuild(image, done));
  });
  it('should be able to build images with registry/namespace/repository, and delete it', function (done) {
    var pack = tar.pack();
    pack.entry({ name: './', type: 'directory' });
    pack.entry({ name: './Dockerfile' }, 'FROM ubuntu\nADD ./src /root/src\n');
    pack.entry({ name: './src', type: 'directory' });
    pack.entry({ name: './src/index.js' }, 'console.log(\'hello\');\n');
    pack.finalize();
    var image = docker.getImage('localhost:5000/docker-mock/buildTest');
    docker.buildImage(pack, { t: 'localhost:5000/docker-mock/buildTest' }, watchBuild(image, done));
  });
  it('should fail building an image w/o a dockerfile', function (done) {
    var badPack = tar.pack();
    badPack.entry({ name: './', type: 'directory' });
    badPack.entry({ name: './src', type: 'directory' });
    badPack.entry({ name: './src/index.js' }, 'console.log(\'hello\');\n');
    badPack.finalize();
    docker.buildImage(badPack, { t: 'buildTest' }, watchBuildFail(done));
  });
  it('should build an image that has been gzipped', function (done) {
    var pack = tar.pack();
    pack.entry({ name: './', type: 'directory' });
    pack.entry({ name: './Dockerfile' }, 'FROM ubuntu\nADD ./src /root/src\n');
    pack.entry({ name: './src', type: 'directory' });
    pack.entry({ name: './src/index.js' }, 'console.log(\'hello\');\n');
    pack.finalize();
    pack = pack.pipe(zlib.createGzip());
    var image = docker.getImage('buildTest');
    pack.pipe(request.post({
      url: 'http://localhost:5354/build',
      qs: { 't': 'buildTest' },
      headers: { 'content-type': 'application/x-gzip' }
    })).on('end', function (err, data) {
      if (err) return done(err);
      image.remove(done);
    }); 
  });
  it('should list all the images when there are none', function (done) {
    docker.listImages({}, function (err, images) {
      if (err) return done(err);
      images.length.should.equal(0);
      done();
    });
  });
  describe('interactions', function () {
    beforeEach(function (done) {
      var pack = tar.pack();
      pack.entry({ name: './', type: 'directory' });
      pack.entry({ name: './Dockerfile' }, 'FROM ubuntu\nADD ./src /root/src\n');
      pack.entry({ name: './src', type: 'directory' });
      pack.entry({ name: './src/index.js' }, 'console.log(\'hello\');\n');
      pack.finalize();
      docker.buildImage(pack, { t: 'testImage' }, watchBuild(done));
    });
    afterEach(function (done) {
      docker.getImage('testImage').remove(done);
    });
    it('should list all the images', function (done) {
      docker.listImages(function (err, images) {
        if (err) return done(err);
        images.length.should.equal(1);
        images[0].RepoTags.length.should.equal(1);
        images[0].RepoTags[0].should.equal('testImage');
        done();
      });
    });
  });
});

describe('misc', function () {
  describe('/info', function () {
    it('should return info data', function (done) {
      docker.info(done);
    });
  });
  describe('/version', function () {
    it('should return version data', function (done) {
      docker.version(done);
    });
  });
});

describe('invalid endpoints', function () {
  it('should respond with an error', function (done) {
    request.get('http://localhost:5354/_nope', function (err, res) {
      if (err && res.statusCode === 501) done(err);
      else if (res.statusCode !== 501) done('should have sent a 501 error');
      else done();
    });
  });
});

afterEach(checkClean);
beforeEach(checkClean);

function checkClean (cb) {
  // the repository should be clean!
  async.parallel([
    checkImages,
    checkContainers,
    checkInfo
  ], cb);
}

function checkImages (cb) {
  async.waterfall([
    docker.listImages.bind(docker, {}),
    function (images, cb) {
      images.length.should.equal(0);
      cb();
    }
  ], cb);
}

function checkContainers (cb) {
  async.waterfall([
    docker.listContainers.bind(docker),
    function (containers, cb) {
      containers.length.should.equal(0);
      cb();
    }
  ], cb);
}

function checkInfo (cb) {
  async.waterfall([
    docker.info.bind(docker),
    function (data, cb) {
      data.Containers.should.equal(0);
      data.Images.should.equal(0);
      data.Mock.should.be.true;
      cb();
    }
  ], cb);
}

function watchBuild(removeImage, cb) {
  if (typeof removeImage === 'function') {
    cb = removeImage;
    removeImage = false;
  }
  return function (err, res) {
    if (err) return cb(err);
    res.on('data', function () {});
    res.on('end', function () {
      if (removeImage) removeImage.remove(cb);
      else cb();
    });
  };
}

function watchBuildFail(cb) {
  return function (err, res) {
    if (err && err.statusCode === 500) cb();
    else cb('expected to fail');
  };
}