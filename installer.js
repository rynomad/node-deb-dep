#!/usr/bin/node
'use strict';

const path = process.argv[2] || "."
const lib_dir = __dirname + "/test/node_modules/"
const app_dir = __dirname + "/testapp/"
const fs = require("fs.extra")
const fss = require("fs");
const shrinkwrap = require(path + "/npm-shrinkwrap.json")
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
  installer.stderr.pipe(process.stderr)
  installer.on('close', (code) => {
    if (code)
      rej(code)
    else
      res()
  })
})
let i = 0

var modules = new Map();


var mountfile = fss.createWriteStream(app_dir + "mount")

const install = (cwd, node, name) => {
  let installpath = lib_dir + name + "/" + node.version.split(".").join("/")
  ++i;
  if (node.dependencies)
    Object.keys(node.dependencies).forEach((dep) => {
      fs.mkdirRecursiveSync(installpath + "/package/node_modules/" + dep)
    })
  else
    fs.mkdirRecursiveSync(installpath)

  mountfile.write(installpath + "/package " + cwd + "\n")
  modules.set(installpath, node)
}

var failures = []

process.on('exit', () => {
  console.log("failures")
  console.log(failures)
  process.exit()
})

const traverse = (cwd, node, name) => {
  if (name)
    install(cwd, node, name)
  else 
    Object.keys(node.dependencies).forEach((key) => fs.mkdirRecursiveSync(cwd + "/node_modules/" + key))
  if (node.dependencies)
    Object.keys(node.dependencies).forEach((key) => traverse( cwd + "/node_modules/" + key, node.dependencies[key], key))
}
let j = 0;
fs.mkdirRecursiveSync(app_dir + shrinkwrap.name + "/node_modules")
traverse(app_dir + shrinkwrap.name, shrinkwrap)
console.log(modules.size)

for (var mod of modules){
  let installpath = mod[0]
    , node = mod[1];

  try {
    require(installpath + "/package/package.json")
  } catch (e){
  try {
    http.get(node.resolved, (res) => {
      res.pipe(gunzip()).pipe(tar.extract(installpath)).on('finish', () => {
        //console.log("?", installpath)
        //fs.copyRecursiveSync(installpath + "/package", installpath)

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
                 .catch((er) => failures.push("INSTALL: " +  installpath))
                 .then(() => {
                  process.stdout.write('.')
                  if (queue.getQueueLength + queue.getPendingLength === 0)
                    process.exit()
                 })
          })
        })

      })
    }).on('error', (err) => {
      console.log("er", node.resolved )
      failures.push("!GET: " + installpath)
    })
  } catch (e) {
    console.log("<<<", node.resolved)
  }

}
}


/*

*/
console.log(i, "mounts")