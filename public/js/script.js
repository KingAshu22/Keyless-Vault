(() => {
  const form = document.querySelector(".form");

  const arrayBufferToBase64 = (buffer) => {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  };

  const createRandomUint8Array = () => {
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    return challenge;
  };

  const createCredentialsConfig = (name, email) => ({
    publicKey: {
      challenge: createRandomUint8Array().buffer,
      rp: {
        name: "Ashish Prasad", // Replace with your RP name
        id: "722wjbn9-3000.inc1.devtunnels.ms",
      },
      user: {
        id: createRandomUint8Array(),
        name: name,
        displayName: name,
        email: email,
      },
      authenticatorSelection: {
        authenticatorAttachment: "cross-platform", // Change to "platform"
        userVerification: "preferred",
      },
      attestation: "direct",
      pubKeyCredParams: [
        {
          type: "public-key",
          alg: -7,
        },
      ],
      sameOriginWithAncestors: false,
    },
  });

  // Update the handleRegister function to send registration data to the server
  const handleRegister = async (event) => {
    event.preventDefault();

    try {
      const nameInput = document.querySelector('input[name="name"]');
      const emailInput = document.querySelector('input[name="email"]');
      const name = nameInput.value;
      const email = emailInput.value;

      const config = createCredentialsConfig(name, email);

      const credentials = await navigator.credentials.create(config);
      const rawId = arrayBufferToBase64(credentials.rawId);
      const clientDataJSON = arrayBufferToBase64(
        credentials.response.clientDataJSON
      );

      // Send registration data to the server
      const response = await fetch("/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          name,
          rawId,
          clientDataJSON,
        }),
      });

      if (response.ok) {
        console.log("User registered successfully");
        // Handle successful registration, e.g., redirect to dashboard
      } else {
        console.error("Failed to register user:", response.statusText);
        // Handle registration failure, e.g., display error message to the user
      }
    } catch (error) {
      console.error("Error registering user:", error);
      // Handle registration error, e.g., display error message to the user
    }
  };

  form.addEventListener("submit", handleRegister);
})();
