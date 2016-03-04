#!/bin/bash
FILES=/etc/node-deb-dep/mounts/
for file in $FILES
do
  echo "setting mounts for $file file..."
  # take action on each file. $f store current file name
  while read src target ; do 
#    echo $src $target
    /bin/mount --bind --make-slave $src $target
    /bin/mount -o remount,ro,bind $src $target
  done < $f
done
