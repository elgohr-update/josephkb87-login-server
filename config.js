/**
 * Configuration
 *
 * A .env file is required.
 * Required keys: PORT
 * Recommennded keys: BASE_URL, NODE_ENV, SESSION_SECRET
 * Optional keys: MONGO_USER, MONGO_PASS, MONGO_HOST, MONGO_PORT, MONGO_DB, RATE_LIMIT_WINDOW, RATE_LIMIT_MAX
 *
 */
require("dotenv").config()
const fs = require("fs")
const url = require("url")
const rsa = require("node-rsa")
const jwt = require("jsonwebtoken")

const
  env = process.env.NODE_ENV || "development",
  baseUrl = process.env.BASE_URL || `http://localhost${process.env.PORT ? ":" + process.env.PORT : ""}`,
  port = process.env.PORT,
  sessionSecret = process.env.SESSION_SECRET || "keyboard cat",
  mongoUser = process.env.MONGO_USER || "",
  mongoPass = process.env.MONGO_PASS || "",
  mongoAuth = mongoUser ? `${mongoUser}:${mongoPass}@` : "",
  mongoHost = process.env.MONGO_HOST || "localhost",
  mongoPort = process.env.MONGO_PORT || 27017,
  mongoDb = (process.env.MONGO_DB || "login-server") + (env == "test" ? "-test" : ""),
  mongoUrl = `mongodb://${mongoAuth}${mongoHost}:${mongoPort}/${mongoDb}`,
  mongoOptions = {
    reconnectTries: 60,
    reconnectInterval: 1000,
    useNewUrlParser: true
  },
  rateLimitWindow = process.env.RATE_LIMIT_WINDOW || (60 * 1000),
  rateLimitMax = process.env.RATE_LIMIT_MAX || 10,
  privateKeyPath = process.env.JTW_PRIVATE_KEY_PATH,
  publicKeyPath = process.env.JTW_PUBLIC_KEY_PATH,
  jwtAlgorithm = process.env.JWT_ALGORITHM || "RS256",
  title = process.env.TITLE || "Login Server"

let allowedOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").filter(origin => origin != "")

let purl = url.parse(baseUrl)
if (!["http:", "https:"].includes(purl.protocol) || !purl.slashes || !purl.hostname) {
  console.error("Please provide a full BASE_URL in .env.")
  process.exit(1)
}
allowedOrigins.push(`${purl.protocol}//${purl.hostname}`)
console.log("Allowed origins:", allowedOrigins.join(", "))

// Add base URL without protocol and information about SSL
const
  cleanUrl = baseUrl.replace(`${purl.protocol}//`, "") + "/",
  ssl = purl.protocol == "https:"

let jwtExpiresIn = parseInt(process.env.JWT_EXPIRES_IN) || 120
if (jwtExpiresIn < 10) {
  console.warn("Warning: Minimum for JWT_EXPIRES_IN is 10 seconds.")
  jwtExpiresIn = 10
}

let config = {
  env,
  baseUrl: baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length - 1) : baseUrl,
  cleanUrl,
  ssl,
  port,
  database: {
    url: mongoUrl,
    options: mongoOptions,
  },
  sessionSecret,
  rateLimitOptions: {
    windowMs: rateLimitWindow,
    max: rateLimitMax,
  },
  jwtOptions: {
    algorithm: jwtAlgorithm,
    expiresIn: jwtExpiresIn
  },
  allowedOrigins,
  title,
}

/**
 * ##### RSA Key Setup #####
 */

let privateKey, publicKey
try {
  privateKey = fs.readFileSync(privateKeyPath || "./private.key")
  publicKey = fs.readFileSync(publicKeyPath || "./public.key")
  // Test keys by using jwt
  let testToken = jwt.sign({ test: "test" }, privateKey, config.jwtOptions)
  jwt.verify(testToken, publicKey)
  console.log("Loaded RSA keypair.")
} catch(error) {
  if (privateKeyPath || publicKeyPath || privateKey || publicKey) {
    let errorName = error.name
    let errorCode = error.code
    if (errorName === "Error" && errorCode === "ENOENT") {
      console.error(`Error: Could not find key at path ${error.path}.`)
    } else if (errorName === "JsonWebTokenError") {
      console.error("Error: Testing provided keypair failed (could not verify a signed token).")
    } else {
      console.error(`Error: Unkown error when loading keypair. (${errorName}, ${errorCode}, ${error.message})`)
    }
    process.exit(1)
  }
  console.log("Generating new keypair and saving to `./private.key` and `./public.key`...")
  let key = new rsa({ b: 2048 })
  privateKey = key.exportKey("private")
  publicKey = key.exportKey("public")
  // Backup existing key files
  for (let filename of ["./private", "./public"]) {
    let index = 0
    let file = (index) => filename + (index ? `.backup.${index}` : "") + ".key"
    while (fs.existsSync(file(index))) {
      index += 1
    }
    if (index > 0) {
      console.warn(`Renaming ${file(0)} to ${file(index)}...`)
      fs.renameSync(file(0), file(index))
    }
  }
  // Save keys to files
  fs.writeFileSync("./private.key", privateKey)
  fs.chmodSync("./private.key", "600")
  fs.writeFileSync("./public.key", publicKey)
  fs.chmodSync("./public.key", "644")
}
config.privateKey = privateKey
config.publicKey = publicKey
config.key = new rsa(privateKey)

/**
 * ##### Providers Setup #####
 */

if (env != "test") {
  // Load providers
  try {
    config.providers = require("./providers.json")
  } catch(error) {
    config.providers = []
  }
  // Prepare providers
  let imageFormats = ["svg", "png", "jpg"]
  for (let provider of config.providers) {
    provider.loginURL = `${baseUrl}/login/${provider.id}`,
    provider.callbackURL = `${baseUrl}/login/${provider.id}/return`
    // Add image URL if a file for that provider can be found
    if (!provider.image) {
      for (let format of imageFormats) {
        let file = `static/${provider.id}.${format}`
        if (fs.existsSync(file)) {
          provider.image = `${baseUrl}/${file}`
          break
        }
      }
    } else if (!provider.image.startsWith("http")) {
      // If it's a relative URL, prepend the baseUrl
      provider.image = `${baseUrl}/${provider.image}`
    }
  }
} else {
  // Configure a test provider for tests
  config.providers = [
    {
      id: "test",
      strategy: "test",
      name: "Test",
      credentialsNecessary: true,
      options: {
        users: [
          {
            username: "testuser",
            password: "testtest",
            displayName: "A Test User"
          }
        ]
      }
    }
  ]
}


module.exports = config
