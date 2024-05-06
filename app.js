const express = require("express");
const session = require("express-session");
const mongoose = require("mongoose");
const { ObjectId } = require("mongoose").Types;
const bodyParser = require("body-parser");
const crypto = require("crypto");
const Passage = require("@passageidentity/passage-node");
const cron = require("node-cron");
const nodemailer = require("nodemailer");
const twilio = require("twilio");
require("dotenv").config();

const app = express();

// MongoDB connection
mongoose.connect(process.env.MONGODB_URL);

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
  phoneNumber: String,
  vault: [
    {
      websiteName: String,
      username: String,
      password: String,
      lastUpdated: Date,
    },
  ],
});

const User = mongoose.model("User", UserSchema);

// Define routes and middleware
app.set("view engine", "ejs");

// Twilio credentials
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

// Create Twilio client
const client = twilio(accountSid, authToken);

const passageConfig = {
  appID: process.env.APP_ID,
  apiKey: process.env.API_KEY,
};

// example of custom middleware
let passage = new Passage(passageConfig);
let passageAuthMiddleware = (() => {
  return async (req, res, next) => {
    try {
      let userID = await passage.authenticateRequest(req);
      if (userID) {
        // user is authenticated
        res.userID = userID;
        let user = await passage.user.get(userID);
        req.session.user = user;
        req.session.user._id = userID;
        next();
      }
    } catch (e) {
      console.log(e);
      res.render("unauthorized.hbs");
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

app.get("/login", (req, res) => {
  res.render("login");
});

app.get("/docs", (req, res) => {
  res.render("docs");
});

app.get("/settings", passageAuthMiddleware, (req, res) => {
  res.render("settings", {
    APP_ID: process.env.APP_ID,
  });
});

app.get("/dashboard", passageAuthMiddleware, async (req, res) => {
  try {
    let userID = res.userID;
    let userData = await passage.user.get(userID);
    const email = userData.email;
    const displayName = userData.user_metadata.display_name;
    const phoneNumber = userData.user_metadata.phone_number;
    const id = userData.id;

    // Check if a user with the same email or ID already exists in MongoDB
    const existingUser = await User.findOne({ $or: [{ email }, { id }] });
    console.log("Getting Existing user data");
    console.log(existingUser);
    // Initialize updatePass count
    let updatePass = 0;

    // Get current date
    const currentDate = new Date();

    if (existingUser) {
      // User already exists, you can choose to handle this case accordingly

      // Iterate over each password object in the vault array
      for (const password of existingUser.vault) {
        // Get the lastUpdated date for the password
        const lastUpdatedDate = new Date(password.lastUpdated);

        // Calculate the difference in milliseconds between lastUpdated date and current date
        const timeDiff = currentDate - lastUpdatedDate;

        // Calculate the difference in days
        const diffDays = Math.ceil(timeDiff / (1000 * 3600 * 24));

        // If the difference is more than one month (30 days), increment updatePass count
        if (diffDays > 30) {
          updatePass++;
        }
      }
      res.render("dashboard", {
        user: existingUser,
        message: "Welcome back!",
        updatePass,
      });
    } else {
      // Create a new user in MongoDB without specifying the _id field
      const newUser = new User({
        id: id,
        email: email,
        displayName: displayName,
        phoneNumber: phoneNumber,
      });
      console.log("Registering new user");
      console.log(newUser);
      await newUser.save();
      // Iterate over each password object in the vault array
      for (const password of newUser.vault) {
        // Get the lastUpdated date for the password
        const lastUpdatedDate = new Date(password.lastUpdated);

        // Calculate the difference in milliseconds between lastUpdated date and current date
        const timeDiff = currentDate - lastUpdatedDate;

        // Calculate the difference in days
        const diffDays = Math.ceil(timeDiff / (1000 * 3600 * 24));

        // If the difference is more than one month (30 days), increment updatePass count
        if (diffDays > 30) {
          updatePass++;
        }
      }
      res.render("dashboard", {
        user: newUser,
        message: "Welcome!",
        updatePass,
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
  console.log(user);

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
      password: encryptedPassword,
      lastUpdated: Date.now(),
    });

    // Save the user with the updated vault
    await user.save();

    res.redirect("/vault"); // Redirect to the vault page after adding the password
  } catch (err) {
    console.error(err);
    res.status(500).send("An error occurred while creating a vault");
  }
});

app.get("/edit-pass/:id", async (req, res) => {
  const vaultid = req.params.id;
  console.log("Vault id = " + vaultid);

  try {
    // Find the user by their ID
    const user = await User.findOne({ id: req.session.user._id });
    console.log(user);

    // Convert vaultid to ObjectId
    const objectId = new ObjectId(vaultid);

    // Find the object in the vault array with the given ID
    const editedObject = user.vault.find((item) => item._id.equals(objectId));
    console.log(editedObject);

    if (!editedObject) {
      // Handle the case where the object with the provided ID was not found
      return res.status(404).send("Object not found");
    }

    const decryptedUsername = decrypt(editedObject.username, user.id);
    const decryptedPassword = decrypt(editedObject.password, user.id);

    // Attach the decrypted values to the editedObject
    editedObject.username = decryptedUsername;
    editedObject.password = decryptedPassword;

    // Render the create-vault page with the found object as a variable
    res.render("edit-vault", { vault: editedObject });
  } catch (err) {
    console.error(err);
    res.status(500).send("An error occurred while editing the object");
  }
});

app.post("/edit-vault", async (req, res) => {
  const websiteName = req.body.websiteName;
  const username = req.body.username;
  const password = req.body.password;
  const vaultId = req.body.id;

  try {
    // Find the user by their ID
    const user = await User.findOne({ id: req.session.user._id });

    // Find the index of the vault entry to be edited
    const index = user.vault.findIndex(
      (vault) => vault._id.toString() === vaultId
    );

    if (index === -1) {
      return res.status(404).send("Vault not found");
    }

    // Encrypt the new password
    const encryptedUsername = encrypt(username, user.id);
    const encryptedPassword = encrypt(password, user.id);

    // Update the vault entry
    user.vault[index].websiteName = websiteName;
    user.vault[index].username = encryptedUsername;
    user.vault[index].password = encryptedPassword;
    user.vault[index].lastUpdated = new Date(); // Set lastUpdated to current date

    // Save the user with the updated vault
    await user.save();

    res.redirect("/vault"); // Redirect to the vault page after updating the password
  } catch (err) {
    console.error(err);
    res.status(500).send("An error occurred while editing the vault");
  }
});

// Register Page
app.get("/sign-in", (req, res) => {
  res.render("register", {
    APP_ID: process.env.APP_ID,
  });
});

cron.schedule("47 22 * * *", async () => {
  try {
    // Get all users from the database
    const users = await User.find();

    // Iterate over each user
    for (const user of users) {
      // Initialize flag to check if any password is older than one month
      let isPasswordExpired = false;

      // Iterate over each password in the user's vault
      for (const password of user.vault) {
        const lastUpdatedDate = new Date(password.lastUpdated);
        const currentDate = new Date();

        // Calculate the difference in milliseconds between lastUpdated date and current date
        const timeDiff = currentDate - lastUpdatedDate;

        // Calculate the difference in days
        const diffDays = Math.ceil(timeDiff / (1000 * 3600 * 24));

        // If the difference is more than one month (30 days), send an email notification
        if (diffDays > 30) {
          await sendNotificationEmail(user.email, password.websiteName);
          isPasswordExpired = true;
          break; // No need to check other passwords for this user
        }
      }
      // If any password is older than one month, send an SMS notification
      if (isPasswordExpired) {
        await sendSMSNotification(user.phoneNumber);
      }
    }
  } catch (error) {
    console.error("Error in scheduled task:", error);
  }
});

// Function to send notification email
async function sendNotificationEmail(email, websiteName) {
  // Configure nodemailer to send emails
  const transporter = nodemailer.createTransport({
    service: "gmail", // e.g., Gmail
    auth: {
      user: "ashishprasadtv@gmail.com",
      pass: "valr mupb emcu qmud",
    },
  });

  // Define email options
  const mailOptions = {
    from: "ashishprasadtv@gmail.com",
    to: email,
    subject:
      "Password Update Reminder for " + websiteName + " from Keyless Vault",
    text: "Your saved password(s) need to be updated. Please log in to your account to update them. -Keyless Vault",
  };

  // Send the email
  await transporter.sendMail(mailOptions);
}

// Function to send SMS notification
async function sendSMSNotification(phoneNumber) {
  try {
    // Send SMS message using Twilio client
    await client.messages.create({
      body: "Your saved password(s) need to be updated. Please log in to your account to update them. -Keyless Vault",
      from: twilioPhoneNumber,
      to: phoneNumber,
    });

    console.log("SMS notification sent to:", phoneNumber);
  } catch (error) {
    console.error("Error sending SMS notification:", error);
  }
}

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
