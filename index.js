const config = require("./config.json");
const Discord = require("discord.js");
const express = require("express");
const rest = new Discord.REST({
	version: '10'
}).setToken(config.discord.token);
const fs = require("fs");
const path = require("path");
const colors = require("colors");
const client = new Discord.Client({
	intents: [
		"GuildMessages",
		"GuildMembers",
		"Guilds"
	]
});

const app = express();

// Use sqlite3 for object storage, and create a database if it doesn't exist
const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./levels.db");

// Create table if it doesn't exist
db.run("CREATE TABLE IF NOT EXISTS levels (id TEXT, xp INTEGER, lvl INTEGER, totalXp INTEGER, msgCount INTEGER, tag TEXT)");
// update table if it does exist
// Check if tag column exists in the levels table
db.all("PRAGMA table_info(levels)", async (err, rows) => {
	// Check if tag column exists
	if (rows.filter(row => row.name === "tag").length === 0) {
		// Add tag column
		await db.run("ALTER TABLE levels ADD COLUMN tag TEXT");
	}
});

client.on("ready", async () => {
	console.log(`${colors.cyan("[INFO]")} Logged in as ${colors.green(client.user.tag)}`)
	// Load Commands
	console.log(`${colors.cyan("[INFO]")} Loading Commands...`)
	const commands = require('./commands.json');
	await (async () => {
		try {
			console.log(`${colors.cyan("[INFO]")} Registering Commands...`)
			let start = Date.now()
			// For every guild
			for (const guild of client.guilds.cache.values()) {
				let gStart = Date.now();
				console.log(`${colors.cyan("[INFO]")} Registering Commands for ${colors.green(guild.name)}...`);
				// Register commands
				await rest.put(
					Discord.Routes.applicationGuildCommands(client.user.id, guild.id), {
						body: commands
					},
				);
				console.log(`${colors.cyan("[INFO]")} Successfully registered commands for ${colors.green(guild.name)}. Took ${colors.green((Date.now() - gStart) / 1000)} seconds.`);
			};
			console.log(`${colors.cyan("[INFO]")} Successfully registered commands. Took ${colors.green((Date.now() - start) / 1000)} seconds.`);
		} catch (error) {
			console.error(error);
		}
	})();

	// Log startup time in seconds
	console.log(`${colors.cyan("[INFO]")} Startup took ${colors.green((Date.now() - initTime) / 1000)} seconds.`)
});


client.on("messageCreate", async message => {
	if (message.author.bot) return;
	if (message.channel.type === "DM") return;
	if (config.discord.levels.blacklist.includes(message.channel.id)) return;
	if (config.discord.levels.blacklist.includes(message.channel.parentId)) return;

	// Calculate random xp
	let xp = Math.floor(Math.random() * 10) + 15;
	// If user is not in database, add them, {user: {xp = xp, lvl = 1, totalXp: xp, msgCount = 1}}
	await db.get(`SELECT * FROM levels WHERE id = '${message.author.id}'`, async (err, row) => {
		if (err) {
			console.error(err);
		}
		if (!row) {
			await db.run(`INSERT INTO levels (id, xp, lvl, totalXp, msgCount, tag) VALUES ('${message.author.id}', ${xp}, 1, ${xp}, 1, '${message.author.tag}')`); // Add user to database
		}
	});

	// Get user data
	await db.get(`SELECT * FROM levels WHERE id = '${message.author.id}'`, async (err, row) => {
		if (err) {
			console.error(err);
		}
		if (row) {
			var data = row;
			let lvl = data.lvl;
			data.msgCount++;

			// Cooldown
			if (cooldowns[message.author.id] && new Date() - cooldowns[message.author.id] < config.discord.levels.cooldownMinutes * 60 * 1000) return await db.run(`UPDATE levels SET xp = ${data.xp}, lvl = ${data.lvl}, totalXp = ${data.totalXp}, msgCount = ${data.msgCount} WHERE id = '${message.author.id}'`);
			cooldowns[message.author.id] = new Date();

			data.xp += xp;
			data.totalXp += xp;

			// If user is in database, and xp is greater than or equal to the calculated level up XP, add 1 to lvl and add the remainder to xp
			let lvlUpXp = eval(config.discord.levels.lvlUpEquation);

			// Keep running level up equation until xp is less than the calculated level up xp
			while (data.xp >= lvlUpXp) {
				data.lvl++;
				data.xp -= lvlUpXp;
				lvlUpXp = eval(config.discord.levels.lvlUpEquation);
				// use config.discord.levels.lvlUpMessage to send a message when the user levels up
				message.channel.send(config.discord.levels.lvlUpMessage.replace("{user}", `<@${message.author.id}>`).replace("{lvl}", data.lvl)).then(msg => {
					setTimeout(() => {
						msg.delete();
					}, 10000);
				});
			}

			// Update database
			await db.run(`UPDATE levels SET xp = ${data.xp}, lvl = ${data.lvl}, totalXp = ${data.totalXp}, msgCount = ${data.msgCount}, tag = '${message.author.tag}' WHERE id = '${message.author.id}'`);
		}
	});

});

client.on("interactionCreate", async interaction => {
	if (!interaction.isCommand()) return;
	switch (interaction.commandName) {
		case "rank":
			var user;
			if (interaction.options.getMember("user")) {
				user = interaction.options.getMember("user").user;
			} else {
				user = interaction.user;
			}
			// Get user data
			await db.get(`SELECT * FROM levels WHERE id = '${user.id}'`, async (err, row) => {
				if (err) {
					console.error(err);
				}
				if (!row) return interaction.reply({
					content: "This user has not sent any messages yet.",
					ephemeral: true
				});
				if (row) {
					var data = row;
					let lvl = data.lvl;
					let rank;
					// Calculate rank
					await db.all(`SELECT * FROM levels ORDER BY totalXp DESC`, async (err, rows) => {
						if (err) {
							console.error(err);
						}
						if (rows) {
							let rank = 0;
							for (let i = 0; i < rows.length; i++) {
								if (rows[i].id === user.id) {
									rank = i + 1;
									break;
								}
							}
							interaction.reply({
								embeds: [{
									title: `${user.tag}'s Rank`,
									fields: [{
											name: "Rank",
											value: `#${rank}`,
											inline: true
										},
										{
											name: "Level",
											value: data.lvl,
											inline: true
										},
										{
											name: "XP",
											value: `${data.xp}/${eval(config.discord.levels.lvlUpEquation)}`,
										},
										{
											name: "Total XP",
											value: data.totalXp,
											inline: true
										},
										{
											name: "Messages Sent",
											value: data.msgCount,
											inline: true
										}
									],
									color: 0x00ff00
								}]
							})
						}
					});
				}
			});
			break;
		case "leaderboard":
			await db.all(`SELECT * FROM levels ORDER BY totalXp DESC`, async (err, rows) => {
				if (err) {
					console.error(err);
				}
				if (!rows) return interaction.reply({
					content: "No one has sent any messages yet.",
					ephemeral: true
				});
				if (rows) {
					let leaderboard = [];
					// Top 10
					for (let i = 0; i < 10; i++) {
						if (rows[i]) {
							let user = await client.users.fetch(rows[i].id);
							let lvl = rows[i].lvl;
							leaderboard.push(`${i + 1}. <@${user.id}> - ${rows[i].xp}/${eval(config.discord.levels.lvlUpEquation)} L${rows[i].lvl} - ${rows[i].totalXp} XP - ${rows[i].msgCount} Messages`);
						}
					}
					interaction.reply({
						embeds: [{
							title: "Leaderboard",
							description: leaderboard.join("\n"),
							color: 0x00ff00
						}]
					});
				}
			});
			break;

		case "givexp":
			// Dont gotta check perms, done on discord
			// Dont gotta check arguments, done on discord

			// Get user data
			await db.get(`SELECT * FROM levels WHERE id = '${interaction.options.getUser("user").id}'`, async (err, row) => {
				if (err) {
					console.error(err);
				}
				if (!row) return interaction.reply({
					content: "This user has not sent any messages yet.",
					ephemeral: true
				});
				if (row) {
					var data = row;
					let lvl = data.lvl;
					data.xp += interaction.options.getInteger("amount");
					data.totalXp += interaction.options.getInteger("amount");
					// If user is in database, and xp is greater than or equal to the calculated level up XP, add 1 to lvl and add the remainder to xp
					let lvlUpXp = eval(config.discord.levels.lvlUpEquation);

					// Keep running level up equation until xp is less than the calculated level up xp
					while (data.xp >= lvlUpXp) {
						data.lvl++;
						data.xp -= lvlUpXp;
						lvlUpXp = eval(config.discord.levels.lvlUpEquation);
					}

					// Update database
					await db.run(`UPDATE levels SET xp = ${data.xp}, lvl = ${data.lvl}, totalXp = ${data.totalXp}, msgCount = ${data.msgCount} WHERE id = '${interaction.options.getUser("user").id}'`);
					interaction.reply({
						content: `Gave ${interaction.options.getInteger("amount")} XP to ${interaction.options.getUser("user").tag}!`,
						ephemeral: true
					});
				}
			});
			break;
	};
});


app.get("/api/levels", async (req, res) => {
	// Pretty much send the entire database
	await db.all(`SELECT * FROM levels ORDER BY totalXp DESC`, async (err, rows) => {
		if (err) {
			console.error(err);
			return res.sendStatus(500); // Internal server error
		}
		if (!rows) return res.sendStatus(204) // No content
		if (rows) {
			let output = rows;
			return res.json(output);
		}
	});
});

app.get("/api/levels/:id", async (req, res) => {
	// Get user data
	await db.get(`SELECT * FROM levels WHERE id = '${req.params.id}'`, async (err, row) => {
		if (err) {
			console.error(err);
			return res.sendStatus(500); // Internal server error
		}
		if (!row) return res.sendStatus(404) // Not found
		if (row) {
			let output = row;
			// Get user info {avatar, tag, etc}
			let user = await client.users.fetch(req.params.id);
			output.tag = user.tag;
			output.avatar = user.displayAvatarURL({extension: "png", size: 1024});
			output.banner = user.bannerURL({extension: "png"});
			if (!output.tag) output.tag = "Unknown#0000";
			return res.json(output);
		}
	});
});


// Handle SIGINT gracefully
process.on('SIGINT', async () => {
	await console.log(`${colors.cyan("[INFO]")} Stop received, exiting...`);
	await client.user.setPresence({
		status: "invisible",
		activities: []
	});
	await client.destroy();
	await console.log(`${colors.cyan("[INFO]")} Goodbye!`);
	process.exit(0);
});

// Global error handler
/*process.on('uncaughtException', async (error) => {
	await console.error(`${colors.red("[ERROR]")} Uncaught Exception: ${error}`);
	if (client.user.tag) {
		client.channels.fetch(config.discord.errorChannel).then(async channel => {
			await channel.send({
				embeds: [{
					title: "Uncaught Exception",
					description: `\`\`\`${error}\`\`\``,
					color: 0xff0000
				}]
			});
		});
	}
});*/

if (config.api.enabled) {
	// Start API
	app.listen(config.api.port, () => {
		console.log(`${colors.cyan("[INFO]")} API listening on port ${config.api.port}`);
	});
}

// Global Variables
var cooldowns = {};


console.log(`${colors.cyan("[INFO]")} Starting...`)
// Start timer to see how long startup takes
const initTime = Date.now()
// Login to Discord
client.login(config.discord.token);