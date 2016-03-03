#!/bin/bash
f=./testapp/mount.txt
#for file in $FILES
#do
  echo "setting mounts for $file file..."
  # take action on each file. $f store current file name
  while read mounts ; do 
    echo $mounts
    "mount --bind --make-slave $mounts"
    "mount -o remount,ro,bind $mounts"
  done < $f
#done