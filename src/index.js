const WSS = require("../../website-security-scanner/src/main.js");

const FS = require("./filesystem.js");
const BANKS = require("./banks.js");

const PATHS = {
    BANKS: "../banks/",
    HTML: "../html/",
    HISTORY: "../history/",
    OUTPUT: "../docs/"
};

const DELAY = 5000; // 5 seconds
const TEMPLATES = getTemplates();
const HISTORY = getHistory();

var sitemap = ["https://bankgradesecurity.com/"];

(function main() {

    let {banks, countries} = BANKS.read(PATHS.BANKS);
    banks = BANKS.sort(banks);

    printWelcome(banks.length, Object.keys(countries).length);
    scanWebsites(banks, countries);

})();

/**
 * Print message with estimated time.
 * @param {number} banks
 * @param {number} countries
 */
function printWelcome(banks, countries) {
    let minutes = Math.ceil((banks * DELAY) / (60 * 1000));

    console.log("~~ Bank Grade Security");
    console.log(`Found ${banks} banks from ${countries} countries`);
    console.log(`Estimated time for scanning is ${minutes} minutes`);
    console.log();
}

/**
 * Function to perform scanning of all banks.
 * @param {Object[]} banks
 * @param {Object[]} countries
 */
async function scanWebsites(banks, countries) {

    let results = [];

    // Map to functions.
    let scans = banks.map(bank => () => {
        (new WSS(bank.domain))
        .scan()
        .then(rs => results.push(rs))
    });

    // Call functions successively.
    for (scan of scans) {
        await scan();
        await wait();
    }

    // Add results to each bank.
    banks = banks.map((bank) => {
        bank.results = results.shift();
    });

    createWebsite(banks, countries);

    /**
     * Private function to wait DELAY seconds.
     */
    async function wait() {
        return new Promise((resolve) => {
            setTimeout(resolve, DELAY);
        });
    }

}

/**
 * Function to create the HTML pages for the website.
 * @param {Object[]} banks
 * @param {Object} countries
 */
async function createWebsite(banks, countries) {

    let cards = [];
    let fullResults = {};

    for (code in countries) {
        fullResults[code] = {};
        countries[code].cards = [];
        sitemap.push(code);
    }

    for (bank of banks) {

        let results = processResults(bank.results);
        fullResults[bank.country.code][bank.name] = results;

        let history;
        try {
            history = HISTORY[bank.country.code][bank.name];
        } catch {history = undefined}

        let score = calculateScore(results);
        let grade = calculateGrade(score);
        let urlName = makeUrlSafe(bank.name);

        writeBankPage(bank.country, bank.name, urlName, bank.domain,
            score, grade, results, history);

        let card = {
            score,
            name: bank.name,
            html: makeCard(bank.country.code, bank.name, urlName,
                    bank.domain, score, grade)
        };

        cards.push(card);
        countries[bank.country.code].cards.push(card);

    }

    for (code in countries) {
        writeCountryPage(code, countries[code].name, countries[code].cards);
    }

    writeHomePage(cards);
    FS.writeFile("sitemap.txt",
        sitemap.join("\n" + "https://bankgradesecurity.com/"));

    let date = new Date();
    let year = date.getFullYear();
    let month = date.getMonth() + 1;

    if (10 > month) {
        month = "0" + month.toString();
    } else {
        month = month.toString();
    }

    let orderedResults = {};
    Object.keys(fullResults).sort().forEach((key) => {
        orderedResults[key] = fullResults[key];
    });

    FS.writeFile(PATHS.HISTORY + year + month + ".json",
        JSON.stringify(orderedResults, null, 4));

}

/**
 * Process results returned from WSS into website format.
 * @param {Object} results
 * @returns {Object}
 */
function processResults(results) {

    let response = {};

    response.HTTPS = {
        "Upgrade HTTP": results.upgradeToHttps.result,
        "Secure Redirection": results.secureRedirectionChain.result,
        "Accepts HTTPS": results.accepts.https,
        "HSTS": results.hsts.result,
        "HSTS Long Length": results.hsts.result && (180 <= results.hsts.data.age), // roughly 6 months
        "HSTS Preloaded": results.hsts.result && results.hsts.data.preloaded
    };

    response.TLS = {
        "TLS 1.3 Enabled": results.tlsProtocols.data["1.3"],
        "TLS 1.1 Disabled": !(results.tlsProtocols.data["1.1"]),
        "TLS 1.0 Disabled": !(results.tlsProtocols.data["1.0"]),
        "Forward Secrecy": results.forwardSecrecy.result,
        "Certificate Length": results.certificate.result
    };

    response.DNS = {
        "DNSSEC": results.dnssec.result,
        "CAA": results.caa.result
    };

    response.CSP = parseCsp(results.contentSecurityPolicy.data);

    response.HTTP = {
        "Feature Policy": results.featurePolicy.result,
        "Referrer Policy": results.referrerPolicy.result,
        "MIME Type Sniffing Protection": results.xContentTypeOptions.result
    };

    results["Miscellaneous Headers"] = {
        "Server": (bank.results.server.result ? "" : bank.results.server.data.value),
        "X-Powered-By": (bank.results.poweredBy.result ? "" : bank.results.poweredBy.data.value),
        "ASP.NET Version": (bank.results.aspVersion.result ? "" : bank.results.aspVersion.data.value)
    };

    /**
     * Private function to parse the Content Security Policy header.
     * @param {string} csp
     */
    function parseCsp(csp) {

        let framingProtection = false;
        if (csp["frame-ancestors"] && csp["frame-ancestors"].length) {

            framingProtection = true;
            let sources = " " + csp["frame-ancestors"].join(" ") + " ";

            for (e of [" data: ", " http: ", " https: "]) {
                if (sources.includes(e)) {
                    framingProtection = false;
                }
            }
        }

        let xssProtection = results.contentSecurityPolicy.result;

        return {
            "XSS Protection": xssProtection || results.xXssProtection.result,
            "Framing Protection": framingProtection || results.xFrameOptions.result
        };

    }

    return response;

}

/**
 * Function to calculate a bank's score from the results.
 * @param {Object} results
 * @returns {number}
 */
function calculateScore(results) {

    let total = 0;
    let score = 0;

    for (category in results) {
        for (metric in results[category]) {

            if ("string" === typeof results[category][metric]) {
                continue;
            }

            total += 1;

            if (results[category][metric]) {
                score += 1;
            }

        }
    }

    score *= 100;
    score /= total;
    score = Math.round(score);

    return score;

}

/**
 * Function to return a bank's grade from the score.
 * @param {number} score
 * @returns {string}
 */
function calculateGrade(score) {

    score = Math.floor(score / 20);
    return ["E", "D", "C", "B", "A", "Z"][score];

}

/**
 * Function to make a string safe for use in URL.
 * @param {string} str
 * @returns {string}
 */
function makeUrlSafe(str) {
    return str
        .toLowerCase()
        .replace(/ /g, "-")
        .replace(/&/g, "-")
        .replace(/'/g, "");
}

/**
 * Function to write bank HTML file.
 * @param {Object} country
 * @param {string} name
 * @param {string} urlName
 * @param {string} domain
 * @param {number} score
 * @param {string} grade
 * @param {Object} results
 * @param {Object|undefined} history
 */
function writeBankPage(country, name, urlName, domain,
    score, grade, results, history) {

    try { // Ensure country dir exists
        FS.makeDirectory(PATHS.OUTPUT + country.code);
    } catch (e) {}

    let page = TEMPLATES.BANK;

    page = page.replace(/\$countryCode/g, country.code);
    page = page.replace(/\$upperCountryCode/g, country.code.toUpperCase());
    page = page.replace(/\$name/g, name);
    page = page.replace(/\$score/g, score);
    page = page.replace(/\$grade/g, grade);

    page = page.replace(/\$countryName/g, country.name);
    page = page.replace(/\$domain/g, domain);

    page = page.replace(/\$explanation/g, name + " " + getExplanation(grade));
    page = page.replace(/\$urlSafeName/g, urlName);

    page = page.replace("$main", makeBankMain(results, history));

    let path = country.code + "/" + urlName + ".html";

    FS.writeFile(path, page);
    sitemap.push(country.code + "/" + urlName);

}

/**
 * Function to create a country's HTML page.
 * @param {string} code
 * @param {string} name
 * @param {Object[]} cards
 */
function writeCountryPage(code, name, cards) {

    let page = TEMPLATES.COUNTRY;

    page = page.replace(/\$countryCode/g, code);
    page = page.replace(/\$countryName/g, name);

    cards = sortCards(cards);
    let html = cards.map(c => c.html).join("\n");

    page = page.replace("$main", html);

    FS.writeFile(code + ".html", page);

}

/**
 * Function to create the homepage.
 * @param {Object[]} cards
 */
function writeHomePage(cards) {

    let page = TEMPLATES.HOMEPAGE;

    let sortedCountryCodes = Object.keys(countries).sort();
    let replace = [];

    for (code of sortedCountryCodes) {
        replace.push(
            "<a href=https://bankgradesecurity.com/" + code + ">" +
            countries[code].name + "</a>"
        );
    }

    page = page.replace("$countries", replace.join("\n"));
    cards = sortCards(cards);

    let main = "";
    for (card of cards) {
        main += card.html + "\n";
    }
    page = page.replace("$main", main);

    FS.writeFile("index.html", page);

}

/**
 * Function to sort HTML cards.
 * @param {Object[]} cards
 */
function sortCards(cards) {

    return cards.sort((a, b) => {

        if (a.score < b.score) {
            return 1;
        } else if (a.score > b.score) {
            return -1;
        }

        if (a.name < b.name) {
            return -1;
        } else if (a.name > b.name) {
            return 1;
        }

        return 0;

    });

}

/**
 * Function to make the main section of the bank HTML page.
 * @param {Object} results
 * @param {Object|undefined} history
 * @returns {string}
 */
function makeBankMain(results, history) {

    let main = "";

    let categoryHtmlTop = "<section>\n<div class=top>$category</div>\n";
    let categoryHtmlBottom = "</section>\n";

    for (category in results) {
        main += categoryHtmlTop.replace("$category", category);

        for (metric in results[category]) {
            let result = results[category][metric];
            let grade;
            let check;

            if ("boolean" == typeof result) {
                grade = (result ? "A" : "E") + " check";
                check = (result ? "&check;" : "&cross;");
            } else {
                grade = (("" === result) ? "italic" : "");
                check = (("" === result) ? "hidden" : htmlEncode(result));
            }

            main +=
                '<div class=measure>' +
                '<span>' + metric + '</span>' +
                '<div class=results>' +
                '<div class="result ' + grade + '">' + check + '</div>' +
                '</div>' +
                '</div>\n';
        }

        main += categoryHtmlBottom;
    }

    if (history) {
        main += categoryHtmlTop.replace("$category", "History");

        for (date in history) {

            let scan = history[date];

            let year = date.substring(0, "2020".length);
            let month = convertMonth(parseInt(date.substring("2020".length)));

            main +=
                '<div class=history>' +
                '<div class="grade ' + scan.grade + '">' + scan.score + '</div>' +
                '<p>' + month + ' ' + year + '</p>' +
                '</div>\n';

        }

        main += categoryHtmlBottom;
    }

    return main;

}

/**
 * Function to encode unsafe HTML characters.
 * @param {string} string
 * @returns {string}
 */
function htmlEncode(string) {

    let replace = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&apos;",
        "\"": "&quot;"
    };

    for (c in replace) {
        string = string.split(c).join(replace[c]);
    }

    return string;

}

/**
 * Function to convert number to month name.
 * @param {number} month
 */
function convertMonth(month) {

    return [
        undefined, // makes months 1 indexed.
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December"
    ][month];

}

/**
 * Function to return the grade-based explanation.
 * @param {string} grade
 * @returns {string}
 */
function getExplanation(grade) {

    if (grade == "Z") {
        return "has excellent website security. They have passed every test.";

    } else if (grade == "A") {
        return "has very good security. They have passed almost every test.";

    } else if (grade == "B") {
        return "has above average security. They have passed most of the tests.";

    } else if (grade == "C") {
        return "has average security. They have failed around half of the tests.";

    } else if (grade == "D") {
        return "has below average security. They have failed most of the tests.";

    } else if (grade == "E") {
        return "has very bad security. They have failed almost every on of the tests.";
    }

}

/**
 * Function to create a bank's HTML card.
 * @param {string} countryCode
 * @param {string} bankName
 * @param {string} urlName
 * @param {string} domain
 * @param {number} score
 * @param {string} grade
 * @returns {string}
 */
function makeCard(countryCode, bankName, urlName, domain, score, grade) {

    return '' +
        '<a class=card href=https://bankgradesecurity.com/' + countryCode + '/' + urlName + '>' +
        '<div class="grade ' + grade + '">' + score + '</div>' +
        '<div class=name>' + bankName + '</div>' +
        '<div class=details>' + countryCode.toUpperCase() + '</div><div class=details>' + domain + '</div>' +
        '</a>';

}

/**
 * Function to read in and prepare HTML files.
 * @returns {Object}
 */
function getTemplates() {

    let filenames = FS.readDirectory(PATHS.HTML);
    let files = {};

    for (filename of filenames) {
        files[filename] = FS.readFile(PATHS.HTML + filename);
    }

    let templates = {};

    for (filename in files) {

        if (filename.toLowerCase().includes("header") ||
            filename.toLowerCase().includes("footer")) {

            continue;
        }

        files[filename] = files[filename]
            .replace("$header", files["templateHeader.html"])
            .replace("$footer", files["templateFooter.html"]);

        let key = filename.substring(0, filename.indexOf(".")); // remove file extension

        templates[key.toUpperCase()] = files[filename];
    }

    return templates;
}

/**
 * Function to read and parse past scan results.
 * @returns {Object}
 */
function getHistory() {

    let history = {};
    const directory = FS.readDirectory(PATHS.HISTORY);

    for (filename of directory) {

        let file = FS.readFile(PATHS.HISTORY + filename);
        file = JSON.parse(file);

        let scanDate = filename.substring(0, filename.indexOf("."));

        for (countryCode in file) {
            if (undefined === history[countryCode]) {
                history[countryCode] = {};
            }

            for (bankName in file[countryCode]) {
                if (undefined === history[countryCode][bankName]) {
                    history[countryCode][bankName] = {};
                }

                let score = calculateScore(file[countryCode][bankName]);
                let grade = calculateGrade(score);

                history[countryCode][bankName][scanDate] = {score, grade};
            }
        }

    }

    return history;

}
