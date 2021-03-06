#!/bin/bash
if [ ! -d "/etc/node-deb-dep/mounts" ]; then
  exit 0;
  # Control will enter here if $DIRECTORY doesn't exist.
fi

for SCRIPT in /etc/node-deb-dep/mounts/*.umount
do
  if [ -f $SCRIPT -a -x $SCRIPT ]
  then
    $SCRIPT
  fi
done