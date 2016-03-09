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
  if (name && !fs.existsSync(makeInstallpath(node, name))){
    queue.add(() => new Promise((res, rej) => {
      let version = node.version.split('.')
      let url = node.resolved || `https://registry.npmjs.org/${name}/-/${name}-${version[0]}.${version[1]}.${version[2]}.tgz`
      let installpath = makeInstallpath(node, name);

      console.log("node-deb-dep fetch ", url)
      if (url.indexOf("git") === 0){
        let repo = url.split("+")[1]
        let commit = repo.split("#")[1]
        repo = repo.split("#")[0]
        clone(repo, path.join(makeInstallpath(node, name), "package"), {checkout : commit}, () => {
          fs.rmrfSync(path.join(makeInstallpath(node, name), "package", ".git"))
          res()
        })
      } else {
        request(url).on('error', (e) => failures.push(e)).pipe(gunzip()).pipe(tar.extract(makeInstallpath(node, name))).on('finish', () => {
          fs.readdirSync(makeInstallpath(node, name)).forEach((path) => {
            if (path.toLowerCase().indexOf(name.toLowerCase()) > -1){
              fs.renameSync(installpath + "/" + path, installpath + "/package")
            }
          })

          res()
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

const makeTempMounts = (node, targets, sources, parentnode, parentname, name) => {
  out(".")

  if (name && parentname && !fs.existsSync(makeInstallpath(node, name))){
    var target = path.join(makeInstallpath(parentnode, parentname),"package", "node_modules", name);
    var source = path.join(makeInstallpath(node, name),"package");
    targets.push(target);
    sources.push(source);
    queue.add(() => new Promise((res, rej) => {
      fs.mkdirRecursiveSync(target)
      exec(`mount --bind ${source} ${target}`)
      res()
    }))
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
    let pkg = require(path.join(pth,"package.json"))
    (["pre", "", "post"]).forEach((prefix) => {
      if (pkg.scripts && pkg.scripts[`${prefix}install`]){
        queue.add(() => new Promise((res, rej) => {

          let installer = spawn("npm", ["run", `${prefix}install`, "--production", "--unsafe-perm"], {
            cwd : pth
          })
          console.log(`node-deb-dep ${prefix}install`:, path)
          installer.on('error', (err) => {
            rej(err)
          })
          installer.stdout.pipe(process.stdout)
          installer.stderr.pipe(process.stderr)
          installer.on('close', (code) => {
            if (code)
              rej(code)
            else
              res()
          })
        }))
      }
      
    })

  })
}

const cleanTempMounts = (paths) => {
  out(".")
  paths.reverse().forEach(path => {
    queue.add(() => new Promise((res, rej) => {
      exec('umount ' + path)
      res()
    }))
  })
}

const makeMountPoints = (node, name) => {
  out(".")
  if (name && !fs.existsSync(path.join(makeInstallpath(node, name))))
    queue.add(() => new Promise((res, rej) => {
      if (node.dependencies)
        Object.keys(node.dependencies).forEach((key) => {
          fs.mkdirRecursiveSync('/etc/node-deb-dep/node_modules/' + name + '/' + node.version.split(".").join("/") + "/package/node_modules/" + key)
        })
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
    stream.write(makeInstallpath(node, name) + "/package " + wd + "\n")
    rev.push(wd)
  }
  if (node.dependencies){
    Object.keys(node.dependencies).forEach((key) => {
      makeMountFile(node.dependencies[key], path.join(wd, "node_modules", key), stream, rev, key)
    })
  }
}

const makeUMountFile = (name, rev) => {
  var stream = fs.createWriteStream('/etc/node-deb-dep/mounts/' + name + ".umount")
  while (rev.length){
    stream.write(rev.pop() + "\n")
  }
}

queue.add(() => new Promise((res,rej) => {
  console.log("\nfetchNodeModules(shrinkwrap)")
  fetchNodeModules(shrinkwrap)
  console.log("\nmakeTempMounts")
  var targets = [], sources = []
  makeTempMounts(shrinkwrap, targets, sources)
  console.log("\ninstallNodeModules(shrinkwrap)")
  installNodeModules(sources)
  console.log("\ncleanNodeModules(shrinkwrap)")
  cleanTempMounts(targets)
  console.log("\nmakeMountPoints(shrinkwrap)")
  makeMountPoints(shrinkwrap)

  var umount = []
  makeMountFile(shrinkwrap, '/usr/share/' + shrinkwrap.name + "/app", fs.createWriteStream('/etc/node-deb-dep/mounts/' + shrinkwrap.name + ".mount"), umount )
  makeUMountFile(shrinkwrap.name, umount)
  res()
})).then(() => {
  console.log("\nbegin processing queue")
  queue.add(() => new Promise((res, rej) => {
    console.log("exec postinst")
    exec('./postinst.sh')
  }))
})



