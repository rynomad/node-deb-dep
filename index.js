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
const spawn = require('child_process').spawn;
const Queue = require("promise-queue")
var queue = new Queue(5)
const npm_install = (path) => () => new Promise((res, rej) => {
  let installer = spawn("npm", ["install", "--production"], {
    cwd : path
  })
  installer.on('error', (err) => {
    rej(err)
  })
  //installer.stdout.pipe(process.stdout)
  installer.stderr.on('data',() => {})
  installer.on('close', (code) => {
    if (code)
      rej(code)
    else
      res()
  })
})
let i = 0

var modules = new Map();
var mountpoints = []
fs.mkdirRecursiveSync(app_dir + shrinkwrap.name + "/node_modules")
fs.mkdirRecursiveSync(mounts_dir)
fs.mkdirRecursiveSync(modules_dir)

var mountfile = fss.createWriteStream( path.join(mounts_dir , shrinkwrap.name + ".mount"))
var umountfile = fss.createWriteStream( path.join(mounts_dir , shrinkwrap.name + ".umount"))

const install = (cwd, node, name) => {
  let installpath = path.join(modules_dir , name , node.version.split(".").join("/") )
  ++i;
  fs.mkdirRecursiveSync(installpath)
  console.log("add mount")
  mountpoints.push(cwd)
  mountfile.write(path.join(installpath , "/package") + " " + cwd + "\n")
  modules.set(installpath, Object.assign(node,{name : name} ))
}

var failures = []

process.on('exit', (code) => {
  console.log("failures", code)
  console.log(failures)
  process.exit()
})

process.on('uncaughtException', (er) => console.log(er.stack))

const traverse = (cwd, node, name) => {
  if (name)
    install(cwd, node, name)
  else 
    Object.keys(node.dependencies).forEach((key) => fs.mkdirRecursiveSync(cwd + "/node_modules/" + key))
  if (node.dependencies)
    Object.keys(node.dependencies).forEach((key) => traverse( cwd + "/node_modules/" + key, node.dependencies[key], key))
}
let j = 0;
traverse(app_dir + shrinkwrap.name, shrinkwrap)
console.log(modules.size)

for (var mod of modules){
  let installpath = mod[0]
    , node = mod[1]
    , name = node.name;
  try {
    //console.log("try", modules.size)
     require(installpath + "/package/package.json")
  } catch (e){
  try {
    //console.log("???")
    let version = node.version.split('.')
    let url = node.resolved || `https://registry.npmjs.org/${name}/-/${name}-${version[0]}.${version[1]}.${version[2]}.tgz`
    let localH = url.indexOf('http:') === 0 ? require('http') : http
    //console.log("get?")
    if (url.indexOf("git") === 0){
      let repo = url.split("+")[1]
      let commit = repo.split("#")[1]
      repo = repo.split("#")[0]
      clone(repo, installpath + "/package", {checkout : commit}, postFetch)
    } else {
      request(url).on('error', (e) => failures.push(e)).pipe(gunzip()).pipe(tar.extract(installpath)).on('finish', postFetch).on('error', (err) => {
      //console.log("er", node.resolved )
      failures.push("!GET: " + installpath)
    })

    }



    function postFetch () {
        //console.log("?", installpath)
        //fs.copyRecursiveSync(installpath + "/package", installpath)
  	 try {
  	 fss.readdirSync(installpath).forEach((path) => {
  	  if (path.toLowerCase().indexOf(name.toLowerCase()) > -1){
              fss.renameSync(installpath + "/" + path, installpath + "/package")

  	  }
           })


   	 } catch(e){}
            if (node.dependencies)
             Object.keys(node.dependencies).forEach((dep) => {
              fs.mkdirRecursiveSync(installpath + "/package/node_modules/" + dep)
             })

          jsonfile.readFile(installpath + "/package/package.json", (err, json) => {
            if (err){
              return failures.push("READPKG: " + installpath)
            }

            json.dependencies = {};
            json.devDependencies = {};
            jsonfile.writeFile(installpath + "/package/package.json", json, (err) => {
              if (err)
                return failures.push("WRTPKG: " + installpath)
              j++;
              //console.log("queue install", installpath)
              queue.add(npm_install(installpath + "/package"))
                   .catch((er) => failures.push("INSTALL: " + installpath + er + er.stack))
                   .then(() => {
                    process.stdout.write('.')
                    if (queue.getQueueLength + queue.getPendingLength === 0)
                      process.exit()
                   })
            })
          })
      }
    } catch (e) {
      console.log("<<<", e, name)
    }

  }
}

while (mountpoints.length){
  umountfile.write(mountpoints.pop() + "\n")
}
