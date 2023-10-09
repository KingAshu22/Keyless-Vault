const express = require("express");
const session = require("express-session");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const Passage = require("@passageidentity/passage-node");
const crypto = require("crypto");

const app = express();

// MongoDB connection
mongoose.connect(
  "mongodb+srv://ashishprasad9833:fVBJUM78LvabfeB9@cluster0.amaxut4.mongodb.net/",
  {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  }
);

const passageConfig = {
  appID: "l0a8KTe3N5Lbiw7MfrL4gwcV",
  apiKey:
    "WMPwiJAwAa.mUy29oe43zOW1rhKDVQMa40wE7hotxVhzQBaxI0lAIafzSox5eXKppMX2v9gscPU",
};

// Middleware setup
app.use(express.json());
app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(
  session({ secret: "your-secret-key", resave: true, saveUninitialized: true })
);

// Define User Schema and Model (using mongoose)
const UserSchema = new mongoose.Schema({
  id: String,
  email: String,
  displayName: String,
  vault: [
    {
      websiteName: String,
      username: String,
      password: String,
    },
  ],
});

const User = mongoose.model("User", UserSchema);

// Define routes and middleware
app.set("view engine", "ejs");

// example of passage middleware
const passage = new Passage(passageConfig);

let passageAuthMiddleware = (() => {
  return async (req, res, next) => {
    try {
      let userID = await passage.authenticateRequest(req);
      if (userID) {
        // user authenticated
        res.userID = userID;
        let user = await passage.user.get(userID);
        req.session.user = user;
        req.session.user._id = userID;
        next();
      }
    } catch (e) {
      // failed to authenticate
      // we recommend returning a 401 or other "unauthorized" behavior
      console.log(e);
      res.status(401).send("Could not authenticate user!");
    }
  };
})();

// Function to encrypt a password
function encrypt(text, id) {
  const algorithm = "aes-256-cbc";
  const key = crypto.scryptSync(id, "3!pB#9cS$eRtYvXm&lN1oA5lZ", 32);
  const iv = Buffer.alloc(16, 0); // Initialization vector

  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encryptedPassword = cipher.update(text, "utf8", "hex");
  encryptedPassword += cipher.final("hex");

  return encryptedPassword;
}

// Function to decrypt a password
function decrypt(encryptedText, id) {
  const algorithm = "aes-256-cbc";
  const key = crypto.scryptSync(id, "3!pB#9cS$eRtYvXm&lN1oA5lZ", 32);
  const iv = Buffer.alloc(16, 0); // Initialization vector

  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  let decryptedPassword = decipher.update(encryptedText, "hex", "utf8");
  decryptedPassword += decipher.final("utf8");

  return decryptedPassword;
}

app.get("/", (req, res) => {
  res.render("home");
});

app.get("/dashboard", passageAuthMiddleware, async (req, res) => {
  try {
    const userID = res.userID;
    const userData = await passage.user.get(userID);
    const email = userData.email;
    const displayName = userData.user_metadata.display_name;
    const id = userData.id;

    // Check if a user with the same email or ID already exists in MongoDB
    const existingUser = await User.findOne({ $or: [{ email }, { id }] });
    console.log("Getting Existing user data");
    console.log(existingUser);

    if (existingUser) {
      // User already exists, you can choose to handle this case accordingly
      res.render("dashboard", {
        user: existingUser,
        message: "Welcome back!",
      });
    } else {
      // Create a new user in MongoDB without specifying the _id field
      const newUser = new User({
        id: id,
        email: email,
        displayName: displayName,
      });
      console.log("Registering new user");
      console.log(newUser);
      await newUser.save();
      res.render("dashboard", {
        user: newUser,
        message: "Welcome!",
      });
    }
  } catch (error) {
    console.error("Error in /dashboard route:", error);
    // Handle errors appropriately, e.g., redirect to an error page
    res.status(500).json({ error: "An error occurred" });
  }
});

app.get("/vault", async (req, res) => {
  const user = await User.findOne({ id: req.session.user._id });

  // Decrypt the passwords in the vault
  user.vault.forEach((entry) => {
    entry.username = decrypt(entry.username, user.id);
    entry.password = decrypt(entry.password, user.id);
  });

  res.render("vault", {
    user: user,
  });
});

app.get("/create-vault", (req, res) => {
  res.render("create-vault");
});

app.post("/create-vault", async (req, res) => {
  const websiteName = req.body.websiteName;
  const username = req.body.username;
  const password = req.body.password;

  try {
    // Find the user by their ID
    const user = await User.findOne({ id: req.session.user._id });

    // Encrypt the password
    const encryptedUsername = encrypt(username, user.id);
    const encryptedPassword = encrypt(password, user.id);

    // Push the encrypted password to the vault
    user.vault.push({
      websiteName: websiteName,
      username: encryptedUsername,
      password: encryptedPassword, // Store the encrypted password
    });

    // Save the user with the updated vault
    await user.save();

    res.redirect("/vault"); // Redirect to the vault page after adding the password
  } catch (err) {
    console.error(err);
    res.status(500).send("An error occurred while creating a vault");
  }
});

// Register Page
app.get("/sign-in", (req, res) => {
  res.render("register");
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
