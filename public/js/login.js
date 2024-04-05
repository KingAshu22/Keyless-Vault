document.addEventListener("DOMContentLoaded", function () {
  const loginForm = document.getElementById("loginForm");
  const emailInput = document.getElementById("email");
  const webauthnButton = document.getElementById("webauthnButton");

  webauthnButton.addEventListener("click", async function () {
    try {
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: new Uint8Array(32),
          allowCredentials: [
            {
              type: "public-key",
              id: Uint8Array.from([0]),
            },
          ],
          authenticatorSelection: {
            authenticatorAttachment: "platform", // Change to "platform"
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

      const rawId = arrayBufferToBase64(assertion.rawId);
      const clientDataJSON = arrayBufferToBase64(
        assertion.response.clientDataJSON
      );

      // Extract email from the form
      const email = emailInput.value;

      // Send login data to the server
      const response = await fetch("/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          rawId,
          clientDataJSON,
        }),
      });

      if (response.ok) {
        console.log("Login successful");
        // Handle successful login, e.g., redirect to dashboard
      } else {
        console.error("Failed to login:", response.statusText);
        // Handle login failure, e.g., display error message to the user
      }
    } catch (error) {
      console.error("Error logging in:", error);
      // Handle login error, e.g., display error message to the user
    }
  });

  function arrayBufferToBase64(buffer) {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }
});
