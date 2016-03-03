#!/bin/bash
f=./testapp/umount
#for file in $FILES
#do
  echo "removing mounts for $file file..."
  # take action on each file. $f store current file name
  while read mounts ; do 
#    echo $mounts
    umount $mounts
  done < $f
#done
