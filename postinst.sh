#!/bin/bash
find /etc/node-deb-dep/node_modules/ -type d -exec chmod 775 {};
find /etc/node-deb-dep/node_modules/ -type f -exec chmod 664 {};
./mounter.sh;

