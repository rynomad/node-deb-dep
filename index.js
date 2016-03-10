#!/bin/nodejs
'use strict';
const argv = require("minimist")(process.argv)

const clone = require("git-clone")
const request = require('request')
const path = require('path')
const lib_dir = argv.l || argv.lib || "/etc/node-deb-dep"
const modules_dir = path.join(lib_dir , "node_modules")
const mounts_dir = path.join(lib_dir , "mounts")
const app_dir = argv.a || argv.app || "./"
const fs = require("fs.extra")
const fss = require("fs");

const shrinkwrap = require(app_dir + "/npm-shrinkwrap.json")
const jsonfile = require('jsonfile')
const tar = require('tar-fs')
const gunzip = require("gunzip-maybe")
const http = require("https")
const cp = require('child_process')
const spawn = cp.spawn
const exec = cp.execSync;
const Queue = require("promise-queue")
var queue = new Queue(process.arch === "arm" ? 1 : 5)

const out = (c) => process.stdout.write(c)

const makeInstallpath = (node, name) => path.join("/etc/node-deb-dep/node_modules/", name, node.version.split(".").join("/"))

const fetchNodeModules = (node, name) => {
  out(".")
  if (name && !fs.existsSync(path.join(makeInstallpath(node, name), "package", "fetch.ndd"))){
    queue.add(() => new Promise((res, rej) => {
      let version = node.version.split('.')
      let url = node.resolved || `https://registry.npmjs.org/${name}/-/${name}-${version[0]}.${version[1]}.${version[2]}.tgz`
      let installpath = makeInstallpath(node, name);

      out("^")
      if (url.indexOf("git") === 0){
        let repo = url.split("+")[1]
        let commit = repo.split("#")[1]
        repo = repo.split("#")[0]
        clone(repo, path.join(makeInstallpath(node, name), "package"), {checkout : commit}, () => {
          fs.rmrfSync(path.join(makeInstallpath(node, name), "package", ".git"))
          fs.writeFileSync(path.join(installpath, "package", "fetch.ndd"), "true")
          res()
        })
      } else {
        request(url).on('error', (e) => failures.push(e)).pipe(gunzip()).pipe(tar.extract(makeInstallpath(node, name))).on('finish', () => {
          fs.readdirSync(makeInstallpath(node, name)).forEach((path) => {
            if (path.toLowerCase().indexOf(name.toLowerCase()) > -1){
              fs.rmrfSync(installpath + "/package")
              fs.renameSync(installpath + "/" + path, installpath + "/package")
              if (node.dependencies)
                Object.keys(node.dependencies).forEach((key) => {
                  fs.mkdirRecursiveSync(installpath + "/package/node_modules/" + key)
                })
            }
          })
          process.nextTick(() => {
            fs.writeFileSync(path.join(installpath, "package", "fetch.ndd"), "true")
            res()
          })

        }).on('error', (err) => {
          rej(err)
        })
      }
    }))
  }

  if (node.dependencies){
    Object.keys(node.dependencies).forEach((key) => {
      fetchNodeModules(node.dependencies[key], key)
    })
  }
}


var tmpmount = fs.createWriteStream("/tmp/" + shrinkwrap.name + ".mount.sh")
tmpmount.write("#!/bin/bash")
var tmpumount = fs.createWriteStream("/tmp/" + shrinkwrap.name + ".umount.sh")
tmpumount.write("#!/bin/bash")


const makeTempMounts = (node, targets, sources, parentnode, parentname, name) => {
  out(".")

  if (name && parentname && !fs.existsSync(path.join(makeInstallpath(node, name), "package", "installed.ndd"))){
    out("|");
    var target = path.join(makeInstallpath(parentnode, parentname),"package", "node_modules", name);
    var source = path.join(makeInstallpath(node, name),"package");
    targets.push(target);
    sources.push(source);
    fs.mkdirRecursiveSync(target);
    tmpmount.write(`\nmount --bind ${source} ${target};`)
  }

  if (node.dependencies){
    Object.keys(node.dependencies).forEach((key) => {
      makeTempMounts(node.dependencies[key], targets, sources, node, name, key)
    })
  }
}

const installNodeModules = (paths) => {
  out('.')
  paths.reverse().forEach((pth) => {
    queue.add(() => new Promise((res, rej) => {
      //console.log("\ncheck install", pth)
      var pkg = require(path.join(pth,"package.json"))
      var interior = Promise.resolve();
      out("~");
      (["pre", "", "post"]).forEach((prefix) => {
        out(".");
        if (pkg.scripts && pkg.scripts[`${prefix}install`]){
          interior = interior.then(() => new Promise((res, rej) => {
            out("|")
            let installer = spawn("npm", ["run", `${prefix}install`, "--production", "--unsafe-perm"], {
              cwd : pth
            })
            //console.log(`node-deb-dep ${prefix}install: `, pth)
            installer.on('error', (err) => {
              rej(err)
            })
            //installer.stdout.pipe(process.stdout)
            installer.stderr.pipe(process.stderr)
            installer.on('close', (code) => {
              if (code)
                rej(code)
              else
                res()
            })
          })).catch((er) => console.log("interior install err", er, er.stack))
        } 
      })

      interior.then(() => {
        out("#")
        res()
      })
    }))
  })
}

const cleanTempMounts = (paths) => {
  paths.reverse().forEach(path => {
    out(".")
    tmpumount.write(`\numount ${path};\n`)
  })
}

const makeMountPoints = (node, name) => {
  out(".")
  if (name)
    queue.add(() => new Promise((res, rej) => {
      out(".")
      fs.writeFileSync(path.join(makeInstallpath(node, name),"package", "installed.ndd"), "true")
      if (node.dependencies)
        Object.keys(node.dependencies).forEach((key) => {
          fs.mkdirRecursiveSync('/etc/node-deb-dep/node_modules/' + name + '/' + node.version.split(".").join("/") + "/package/node_modules/" + key)
        })
      res()
    }))
  if (node.dependencies){
    Object.keys(node.dependencies).forEach((key) => {
      makeMountPoints(node.dependencies[key], key)
      if (!name)
        fs.mkdirRecursiveSync('/usr/share/' + node.name + "/app/node_modules/" + key)
    })
  }
}

const makeMountFile = (node, wd, stream, rev, name) => {
  if (name){
    let src = path.join(makeInstallpath(node, name) , "package")
    stream.write(`/bin/mount --bind --make-slave ${src} ${wd}\n`)
    stream.write(`/bin/mount -o remount,ro,bind ${src} ${wd}\n`)
    rev.push(wd)
  }
  if (node.dependencies){
    Object.keys(node.dependencies).forEach((key) => {
      makeMountFile(node.dependencies[key], path.join(wd, "node_modules", key), stream, rev, key)
    })
  }
}

const makeUMountFile = (name, rev, umountStream) => {
  umountStream.write("#!/bin/bash\n")
  while (rev.length){
    umountStream.write("umount " + rev.pop() + "\n")
  }
}

queue.add(() => new Promise((res,rej) => {
  console.log("\nfetchNodeModules(shrinkwrap)")
  fetchNodeModules(shrinkwrap)
  console.log("\nmakeTempMounts")
  var targets = [], sources = []
  makeTempMounts(shrinkwrap, targets, sources)
  queue.add(() => new Promise((res, rej) => {
    tmpmount.end("\n", () => {
      console.log("execute mount (LONG)")
      fs.chmodSync("/tmp/" + shrinkwrap.name + ".mount.sh", '755');
      exec("/tmp/" + shrinkwrap.name + ".mount.sh")
      fs.rmrfSync("/tmp/" + shrinkwrap.name + ".mount.sh")
      res()
    })
  }))

  console.log("\ninstallNodeModules(shrinkwrap)")
  installNodeModules(sources)
  console.log("\ncleanNodeModules(shrinkwrap)")
  cleanTempMounts(targets)
  queue.add(() => new Promise((res, rej) => {
    tmpumount.end("\n", () => {
      console.log("excecute umount (LONG)")
      fs.chmodSync("/tmp/" + shrinkwrap.name + ".umount.sh", '755');
      exec("/tmp/" + shrinkwrap.name + ".umount.sh")
      fs.rmrfSync("/tmp/" + shrinkwrap.name + ".umount.sh")
      res()
    })
  }))
  console.log("\nmakeMountPoints(shrinkwrap)")
  makeMountPoints(shrinkwrap)

  var umount = []
  var mountStream = fs.createWriteStream('/etc/node-deb-dep/mounts/' + shrinkwrap.name + ".mount")
  mountStream.write("#!/bin/bash\n")
  var umountStream = fs.createWriteStream('/etc/node-deb-dep/mounts/' + shrinkwrap.name + ".umount")
  makeMountFile(shrinkwrap, '/usr/share/' + shrinkwrap.name + "/app", mountStream, umount )
  makeUMountFile(shrinkwrap.name, umount, umountStream)
  umountStream.end("\n", () => {
    mountStream.end("\n", () => {
      fs.chmodSync('/etc/node-deb-dep/mounts/' + shrinkwrap.name + ".mount", '755');
      fs.chmodSync('/etc/node-deb-dep/mounts/' + shrinkwrap.name + ".umount", '755');
      res()
    })
  })

})).then(() => {
  console.log("\nbegin processing queue")
  queue.add(() => new Promise((res, rej) => {
    console.log("exec postinst")
    exec('./postinst.sh')
    exec('/etc/node-deb-dep/mounts/' + shrinkwrap.name + ".mount")
    res()
  }))
}).catch(er => console.log(er, er.stack))



