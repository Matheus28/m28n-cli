var tar = require("tar");
var fs = require("fs");
var tmp = require("tmp");

var AWS = null;
var s3 = null;

// This is used by the bootstrapping script, as we don't have an api
// running yet when we need to upload the package to s3 directly
if(global.PACKAGER_USE_S3){
	if(!process.env["AWS_ACCESS_KEY_ID"]
	|| !process.env["AWS_SECRET_ACCESS_KEY"]
	|| !process.env["AWS_PACKAGE_BUCKET_NAME"]
	|| !process.env["AWS_PACKAGE_BUCKET_URL"]){
		throw new Error("Some environment variables aren't set");
	}

	AWS = require('aws-sdk');
	AWS.config = new AWS.Config({
		accessKeyId: process.env["AWS_ACCESS_KEY_ID"],
		secretAccessKey: process.env["AWS_SECRET_ACCESS_KEY"],
	});
	
	s3 = new AWS.S3({
		apiVersion: '2006-03-01',
	});
}


module.exports = exports = function(files, direct, cb){
	files = files.concat(); // tar eats our array?
	
	var tmpFilename = tmp.fileSync().name;
	
	//console.log("Creating temporary file " + tmpFilename);
	
	tar.create({
		gzip: {
			level: 9, // Maximum compression
		},
		strict: true,
		file: tmpFilename,
	}, files).then(function(){
		if(direct){
			if(!s3) throw new Error("No s3, you're not supposed to use this");
			
			var key = require("uuid/v4")() + ".tgz";
			
			s3.putObject({
				Bucket: process.env["AWS_PACKAGE_BUCKET_NAME"],
				Key: key,
				Body: fs.createReadStream(tmpFilename),
			}, function(err, data){
				if(err) return cb(err);
				cb(null, { url: process.env["AWS_PACKAGE_BUCKET_URL"] + key });
			});
			
		}else{
			cb(null, { filename: tmpFilename });
		}
	}).catch(cb);
}
