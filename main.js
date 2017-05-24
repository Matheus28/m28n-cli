#!/usr/bin/env node

var program = require("commander");
var path = require("path");
var fs = require("fs");
var request = require("request");
var packager = require("./Packager.js");


program
	.option('-p, --project <filename>', "Use a different project manifest other than ./m28n.json")
	.option('-t, --token <token>', "Account token to use")
	.option('--local', "Use local api server (for debugging purposes)")
;

program.parse(process.argv);
program.project = program.project || "./m28n.json";

var cmdi = 0;

function defaultAPICallback(err, httpResponse, body){
	if(err) fatal(err);
	console.log("API replied with:", body);
}

function fatal(err){
	console.error(err);
	process.exit(1);
}

function getAPIBaseURL(){
	if(program.local){
		return "http://localhost:8080";
	}
	
	var url = "";
	if(process.env["M28N_API_INSECURE"] != "true"){
		url += "https://";
	}else{
		url += "http://";
	}
	
	url += process.env["M28N_API_HOST"] || "api.n.m28.io";
	
	if(process.env["M28N_API_PORT"]){
		url += ":" + process.env["M28N_API_PORT"];
	}
	
	return url;
}

function getToken(){
	if(!program.token && !process.env["M28N_ACCOUNT_TOKEN"]){
		fatal("Use either --token or define M28N_ACCOUNT_TOKEN");
	}
	
	return program.token || process.env["M28N_ACCOUNT_TOKEN"];
}
function accept(str){
	if(program.args[cmdi] == str){
		++cmdi;
		return true;
	}else{
		return false;
	}
}

function demand(desc){
	if(typeof program.args[cmdi] != 'string'){
		fatal(desc);
	}
	
	return program.args[cmdi++];
}

function manifest(){
	var manifestStr;
	try {
		manifestStr = fs.readFileSync(program.project, "utf8");
	}catch(e){
		fatal("Failed to open " + program.project);
	}
	
	var manifestObj;
	try {
		manifestObj = JSON.parse(require('strip-json-comments')(manifestStr));
	}catch(e){
		fatal("Failed to parse manifest, it isn't valid JSON: " + e);
	}
	
	return manifestObj;
}

function help(){
	console.log([
		"m28n deploy -- Deploys the current project",
		"m28n env <env_json> -- Sets the environment variables that all servers use (write-only, useful for storing tokens)",
		"m28n create <identifier> -- Creates a new project",
		"m28n version -- Prints the current deployed version",
		"m28n rollback <version> -- Rolls back the current version to another version",
	].join("\n"));
}

function projectIdentifier(){
	var m = manifest();
	if(typeof m.project != 'string') fatal("Project manifest must have a \"project\" key");
	return m.project;
}

if(accept("deploy")){
	getToken();
	
	var manifestObj = manifest();
	
	// So we can package from that directory
	process.chdir(path.dirname(program.project));
	
	if(!manifestObj.package || !Array.isArray(manifestObj.package)){
		fatal("Manifest should have a top level array of strings called 'package'");
	}
	
	for(var i = 0; i < manifestObj.length; ++i){
		if(typeof manifestObj[i] != 'string'){
			fatal("Manifest should have a top level array of strings called 'package'");
		}
	}
	
	console.log("Packaging up...");
	packager(manifestObj.package, false, function(err, res){
		if(err) return fatal(err);
		
		console.log("Package created at " + res.filename);
			
		var form = {
			package: fs.createReadStream(res.filename),
			manifest: JSON.stringify(manifestObj),
		};
		
		console.log("Sending request to API...");
		request.put({
			url: getAPIBaseURL() + "/project/",
			formData: form,
			headers: {
				'Authorization': 'AccountToken ' + getToken(),
			}
		}, defaultAPICallback);
	});
} else if(accept("create")){
	var identifier = demand("You must provide an identifier");
	request.put({
		url: getAPIBaseURL() + "/project/" + identifier,
		body: "",
		headers: {
			'Authorization': 'AccountToken ' + getToken(),
		},
	}, defaultAPICallback);
}else if(accept("env")){
	var identifier = projectIdentifier();
	var env = demand("You must provide an environment");
	request.put({
		url: getAPIBaseURL() + "/project/" + identifier + "/env",
		body: env,
		headers: {
			'Authorization': 'AccountToken ' + getToken(),
			'Content-Type': 'application/json',
		}
	}, defaultAPICallback);
}else if(accept("version")){
	var identifier = projectIdentifier();
	request.get({
		url: getAPIBaseURL() + "/project/" + identifier + "/version",
		headers: {
			'Authorization': 'AccountToken ' + getToken(),
		}
	}, defaultAPICallback);
}else if(accept("rollback")){
	var identifier = projectIdentifier();
	var version = demand("You must provide a version to rollback to");
	if(version != (version|0).toString()) fatal("Version must be an integer");
	request.put({
		url: getAPIBaseURL() + "/project/" + identifier + "/version",
		body: JSON.stringify({ version: version|0 }),
		headers: {
			'Authorization': 'AccountToken ' + getToken(),
			'Content-Type': 'application/json',
		}
	}, defaultAPICallback);
}else{
	console.log(program.args);
	help();
}

