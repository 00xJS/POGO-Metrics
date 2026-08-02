/* pokedex.js — National-Dex name → number lookup.
 *
 * Niantic exports list part of "Pokemon in your collection" by the internal
 * asset id (e.g. V0025_POKEMON_PIKACHU) and part by plain display name
 * (e.g. "Pikachu", "Unown", "Mr. Mime"). app.js can read the dex number out
 * of the asset-id form directly, but the plain-named species — which in real
 * exports are the older generations (Kanto, Johto, Hoenn) — had no number, so
 * those three regions never showed up in the "Storage by region" bars.
 *
 * This map covers gens 1–3 (every plain-named species seen in real exports).
 * Only the *generation bucket* matters for the region bars, so a species just
 * needs to live in the right list; exact intra-gen order is not load-bearing. */
(function () {
  const GEN1 = [ // 1–151 · Kanto
    "Bulbasaur", "Ivysaur", "Venusaur", "Charmander", "Charmeleon", "Charizard",
    "Squirtle", "Wartortle", "Blastoise", "Caterpie", "Metapod", "Butterfree",
    "Weedle", "Kakuna", "Beedrill", "Pidgey", "Pidgeotto", "Pidgeot", "Rattata",
    "Raticate", "Spearow", "Fearow", "Ekans", "Arbok", "Pikachu", "Raichu",
    "Sandshrew", "Sandslash", "Nidoran♀", "Nidorina", "Nidoqueen",
    "Nidoran♂", "Nidorino", "Nidoking", "Clefairy", "Clefable", "Vulpix",
    "Ninetales", "Jigglypuff", "Wigglytuff", "Zubat", "Golbat", "Oddish",
    "Gloom", "Vileplume", "Paras", "Parasect", "Venonat", "Venomoth", "Diglett",
    "Dugtrio", "Meowth", "Persian", "Psyduck", "Golduck", "Mankey", "Primeape",
    "Growlithe", "Arcanine", "Poliwag", "Poliwhirl", "Poliwrath", "Abra",
    "Kadabra", "Alakazam", "Machop", "Machoke", "Machamp", "Bellsprout",
    "Weepinbell", "Victreebel", "Tentacool", "Tentacruel", "Geodude",
    "Graveler", "Golem", "Ponyta", "Rapidash", "Slowpoke", "Slowbro",
    "Magnemite", "Magneton", "Farfetch'd", "Doduo", "Dodrio", "Seel", "Dewgong",
    "Grimer", "Muk", "Shellder", "Cloyster", "Gastly", "Haunter", "Gengar",
    "Onix", "Drowzee", "Hypno", "Krabby", "Kingler", "Voltorb", "Electrode",
    "Exeggcute", "Exeggutor", "Cubone", "Marowak", "Hitmonlee", "Hitmonchan",
    "Lickitung", "Koffing", "Weezing", "Rhyhorn", "Rhydon", "Chansey",
    "Tangela", "Kangaskhan", "Horsea", "Seadra", "Goldeen", "Seaking", "Staryu",
    "Starmie", "Mr. Mime", "Scyther", "Jynx", "Electabuzz", "Magmar", "Pinsir",
    "Tauros", "Magikarp", "Gyarados", "Lapras", "Ditto", "Eevee", "Vaporeon",
    "Jolteon", "Flareon", "Porygon", "Omanyte", "Omastar", "Kabuto", "Kabutops",
    "Aerodactyl", "Snorlax", "Articuno", "Zapdos", "Moltres", "Dratini",
    "Dragonair", "Dragonite", "Mewtwo", "Mew",
  ];
  const GEN2 = [ // 152–251 · Johto
    "Chikorita", "Bayleef", "Meganium", "Cyndaquil", "Quilava", "Typhlosion",
    "Totodile", "Croconaw", "Feraligatr", "Sentret", "Furret", "Hoothoot",
    "Noctowl", "Ledyba", "Ledian", "Spinarak", "Ariados", "Crobat", "Chinchou",
    "Lanturn", "Pichu", "Cleffa", "Igglybuff", "Togepi", "Togetic", "Natu",
    "Xatu", "Mareep", "Flaaffy", "Ampharos", "Bellossom", "Marill", "Azumarill",
    "Sudowoodo", "Politoed", "Hoppip", "Skiploom", "Jumpluff", "Aipom",
    "Sunkern", "Sunflora", "Yanma", "Wooper", "Quagsire", "Espeon", "Umbreon",
    "Murkrow", "Slowking", "Misdreavus", "Unown", "Wobbuffet", "Girafarig",
    "Pineco", "Forretress", "Dunsparce", "Gligar", "Steelix", "Snubbull",
    "Granbull", "Qwilfish", "Scizor", "Shuckle", "Heracross", "Sneasel",
    "Teddiursa", "Ursaring", "Slugma", "Magcargo", "Swinub", "Piloswine",
    "Corsola", "Remoraid", "Octillery", "Delibird", "Mantine", "Skarmory",
    "Houndour", "Houndoom", "Kingdra", "Phanpy", "Donphan", "Porygon2",
    "Stantler", "Smeargle", "Tyrogue", "Hitmontop", "Smoochum", "Elekid",
    "Magby", "Miltank", "Blissey", "Raikou", "Entei", "Suicune", "Larvitar",
    "Pupitar", "Tyranitar", "Lugia", "Ho-oh", "Celebi",
  ];
  const GEN3 = [ // 252–386 · Hoenn
    "Treecko", "Grovyle", "Sceptile", "Torchic", "Combusken", "Blaziken",
    "Mudkip", "Marshtomp", "Swampert", "Poochyena", "Mightyena", "Zigzagoon",
    "Linoone", "Wurmple", "Silcoon", "Beautifly", "Cascoon", "Dustox", "Lotad",
    "Lombre", "Ludicolo", "Seedot", "Nuzleaf", "Shiftry", "Taillow", "Swellow",
    "Wingull", "Pelipper", "Ralts", "Kirlia", "Gardevoir", "Surskit",
    "Masquerain", "Shroomish", "Breloom", "Slakoth", "Vigoroth", "Slaking",
    "Nincada", "Ninjask", "Shedinja", "Whismur", "Loudred", "Exploud",
    "Makuhita", "Hariyama", "Azurill", "Nosepass", "Skitty", "Delcatty",
    "Sableye", "Mawile", "Aron", "Lairon", "Aggron", "Meditite", "Medicham",
    "Electrike", "Manectric", "Plusle", "Minun", "Volbeat", "Illumise",
    "Roselia", "Gulpin", "Swalot", "Carvanha", "Sharpedo", "Wailmer", "Wailord",
    "Numel", "Camerupt", "Torkoal", "Spoink", "Grumpig", "Spinda", "Trapinch",
    "Vibrava", "Flygon", "Cacnea", "Cacturne", "Swablu", "Altaria", "Zangoose",
    "Seviper", "Lunatone", "Solrock", "Barboach", "Whiscash", "Corphish",
    "Crawdaunt", "Baltoy", "Claydol", "Lileep", "Cradily", "Anorith", "Armaldo",
    "Feebas", "Milotic", "Castform", "Kecleon", "Shuppet", "Banette", "Duskull",
    "Dusclops", "Tropius", "Chimecho", "Absol", "Wynaut", "Snorunt", "Glalie",
    "Spheal", "Sealeo", "Walrein", "Clamperl", "Huntail", "Gorebyss",
    "Relicanth", "Luvdisc", "Bagon", "Shelgon", "Salamence", "Beldum", "Metang",
    "Metagross", "Regirock", "Regice", "Registeel", "Latias", "Latios", "Kyogre",
    "Groudon", "Rayquaza", "Jirachi", "Deoxys",
  ];

  // Normalise a display name to a comparison key: lowercase, gender symbols and
  // "(female)/(male)" → f/m, then strip everything non-alphanumeric. This makes
  // "Nidoran♀", "Nidoran (female)", "Mr. Mime" and "Ho-oh" all match.
  function norm(s) {
    return String(s == null ? "" : s)
      .toLowerCase()
      .replace(/♀/g, "f").replace(/♂/g, "m")
      .replace(/\(\s*female\s*\)/g, "f").replace(/\(\s*male\s*\)/g, "m")
      .replace(/[^a-z0-9]/g, "");
  }

  const MAP = {};
  const add = (names, base) => names.forEach((n, i) => { MAP[norm(n)] = base + i; });
  add(GEN1, 1);
  add(GEN2, 152);
  add(GEN3, 252);

  window.dexFromName = function (name) {
    return MAP[norm(name)] || null;
  };
})();
