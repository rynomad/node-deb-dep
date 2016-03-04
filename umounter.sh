
#!/bin/bash
FILES=/etc/node-deb-dep/mounts/*.mount
for file in $FILES
do
  echo "setting mounts for $file file..."
  # take action on each file. $f store current file name
  while read src target ; do 
#    echo $src $target
    umount $mounts
  done < $file
done
