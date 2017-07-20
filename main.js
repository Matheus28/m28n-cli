#!/usr/bin/env node

var program = require("commander");
var path = require("path");
var fs = require("fs");
var request = require("request");
var packager = require("./Packager.js");
var Table = require("easy-table");


program
	.option('-p, --project <filename>', "Use a different project manifest other than ./m28n.json")
	.option('-i, --project-id <identifier>', "Use a different project identifier")
	.option('-t, --token <token>', "Account token to use")
	.option('--override <json>', "Overrides contents of the manifest with this")
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
	
	if(program.projectId) manifestObj.project = program.projectId;
	if(program.override){
		var obj;
		try {
			obj = JSON.parse(program.override);
		}catch(e){
			fatal("Failed to parse JSON in --override: " + e);
		}
		
		for(var i in obj){
			manifestObj[i] = obj[i];
		}
	}
	
	return manifestObj;
}

function help(){
	console.log([
		"m28n deploy -- Deploys the current project",
		"m28n deploy manifest [version] -- Updates the manifest of a specific version, or the current if none is specified",
		"m28n status -- Prints the status of the current project",
		"m28n servers -- Prints all servers associated with the current project",
		"m28n env <env_json> -- Sets the environment variables that all servers use (write-only, useful for storing tokens)",
		"m28n create <identifier> -- Creates a new project",
		"m28n version -- Prints the current deployed version",
		"m28n rollback [version] -- Rolls back the current version to another version",
		"m28n linode -- Changes the linode API key associated with the account",
		"m28n vultr -- Changes the vultr API key associated with the account",
	].join("\n"));
}

function projectIdentifier(){
	if(program.projectId) return program.projectId;
	var m = manifest();
	if(typeof m.project != 'string') fatal("Project manifest must have a \"project\" key");
	return m.project;
}

function hasMoreArgs(){
	return cmdi < program.args.length;
}

function eoa(){
	if(hasMoreArgs()){
		fatal("Unexpected arguments: " + program.args.slice(cmdi).join(', '));
	}
}

function grabObject(body){
	if(typeof body != 'string') return body;
	try {
		return JSON.parse(body);
	}catch(e){
		fatal("Failed to parse JSON from API: " + body);
	}
}

function question(str, cb){
	var readline = require("readline");
	var rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});

	rl.question(str, function(answer){
		cb(answer);
		rl.close();
	});
}

function renderTables(err, res, body){
	if(err) return fatal(err);
	
	var obj = grabObject(body);
	if(!obj.tables) return fatal("API replied with unexpected response: " + body);
	
	obj.tables.forEach(function(data){
		var t = new Table();
		
		data.values.forEach(function(row){
			row.forEach(function(_, i){
				t.cell(data.headers[i], row[i]);
			});
			
			t.newRow();
		});
		
		console.log(t.toString());
	});
}

function withCurrentVersion(fn){
	console.log("Fetching current version...");
	request.get({
		url: getAPIBaseURL() + "/project/" + projectIdentifier() + "/version",
		headers: {
			'Authorization': 'AccountToken ' + getToken(),
		}
	}, function(err, res, body){
		if(err) fatal(err);
		
		var obj = grabObject(body);
		if(!obj.version) fatal("Couldn't identify current version in API reply: " + body);
		
		console.log("Current version is " + obj.version);
		fn(obj.version);
	});
}

if(accept("deploy")){
	if(accept("manifest")){
		
		var updateManifest = function(version){
			console.log("Updating manifest...");
			
			request.put({
				url: getAPIBaseURL() + "/project/" + projectIdentifier() + "/manifest",
				body: JSON.stringify({ version: version, manifest: manifest() }),
				headers: {
					'Authorization': 'AccountToken ' + getToken(),
					'Content-Type': 'application/json',
				}
			}, defaultAPICallback);
		}
		
		if(hasMoreArgs()){
			var version = demand("You must provide a version to rollback to");
			if(version != (version|0).toString()) fatal("Version must be an integer");
			eoa();
			updateManifest(version);
		}else{
			eoa();
			withCurrentVersion(updateManifest);
			
		}
	}else{
		eoa();
		getToken(); // Makes sure we have an account token before we pack things up
		
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
			request.post({
				url: getAPIBaseURL() + "/project/",
				formData: form,
				headers: {
					'Authorization': 'AccountToken ' + getToken(),
				}
			}, defaultAPICallback);
		});
	}
	
	
}else if(accept("status")){
	eoa();
	
	request.get({
		url: getAPIBaseURL() + "/project/" + projectIdentifier(),
		headers: {
			'Authorization': 'AccountToken ' + getToken(),
		}
	}, renderTables);
}else if(accept("servers")){
	eoa();
	
	request.get({
		url: getAPIBaseURL() + "/project/" + projectIdentifier() + "/servers/",
		headers: {
			'Authorization': 'AccountToken ' + getToken(),
		}
	}, renderTables);
}else if(accept("linode")){
	eoa();
	question("Linode API key: ", function(key){
		request.put({
			url: getAPIBaseURL() + "/account/linodeKey",
			body: JSON.stringify({ key: key }),
			headers: {
				'Authorization': 'AccountToken ' + getToken(),
				'Content-Type': 'application/json',
			}
		}, defaultAPICallback);
	});
}else if(accept("vultr")){
	eoa();
	question("Vultr API key: ", function(key){
		request.put({
			url: getAPIBaseURL() + "/account/vultrKey",
			body: JSON.stringify({ key: key }),
			headers: {
				'Authorization': 'AccountToken ' + getToken(),
				'Content-Type': 'application/json',
			}
		}, defaultAPICallback);
	});
} else if(accept("create")){
	var identifier = demand("You must provide an identifier");
	eoa();
	request.put({
		url: getAPIBaseURL() + "/project/" + identifier,
		body: "",
		headers: {
			'Authorization': 'AccountToken ' + getToken(),
		},
	}, defaultAPICallback);
}else if(accept("env")){
	var env = demand("You must provide an environment");
	eoa();
	request.put({
		url: getAPIBaseURL() + "/project/" + projectIdentifier() + "/env",
		body: env,
		headers: {
			'Authorization': 'AccountToken ' + getToken(),
			'Content-Type': 'application/json',
		}
	}, defaultAPICallback);
}else if(accept("version")){
	eoa();
	request.get({
		url: getAPIBaseURL() + "/project/" + projectIdentifier() + "/version",
		headers: {
			'Authorization': 'AccountToken ' + getToken(),
		}
	}, defaultAPICallback);
}else if(accept("rollback")){
	var rollbackTo = function(version){
		request.put({
			url: getAPIBaseURL() + "/project/" + projectIdentifier() + "/version",
			body: JSON.stringify({ version: version|0 }),
			headers: {
				'Authorization': 'AccountToken ' + getToken(),
				'Content-Type': 'application/json',
			}
		}, defaultAPICallback);
	}
	
	if(hasMoreArgs()){
		var version = demand("You must provide a version to rollback to");
		if(version != (version|0).toString()) fatal("Version must be an integer");
		eoa();
		rollbackTo(version);
	}else{
		eoa();
		
		withCurrentVersion(function(curVersion){
			rollbackTo(curVersion - 1);
		});
	}
}else if(accept("account")){
	if(accept("create")){
		eoa();
		
		request.post({
			url: getAPIBaseURL() + "/account/",
			body: "",
			headers: {
				'Authorization': 'AccountToken ' + getToken(),
			},
		}, defaultAPICallback);
	}else if(accept("projects")){
		request.get({
			url: getAPIBaseURL() + "/account/projects",
			headers: {
				'Authorization': 'AccountToken ' + getToken(),
			},
		}, function(err, res, body){
			if(err) return fatal(err);
			
			var obj = grabObject(body);
			if(!obj.projects) return fatal("API replied with unexpected response: " + body);
			
			if(obj.projects.length == 0){
				console.log("Account doesn't have any projects");
			}else{
				var t = new Table();
				
				obj.projects.sort(function(a, b){ return a.id < b.id ? -1 : 1; });
				obj.projects.forEach(function(project){
					project.versions.sort(function(a, b){ return a.num - b.num; });
					project.versions.forEach(function(version){
						t.cell("Project", project.id);
						t.cell("Version", version.num);
						t.cell("State", version.state);
						t.cell("Num Services", version.numServices);
						t.newRow();
					})
				});
				
				console.log(t.toString());
			}
			
		});
	}else{
		help();
	}
}else{
	help();
	eoa();
}

