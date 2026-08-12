export default function Terms() {
  return (
    <div className="max-w-3xl mx-auto p-8 text-white/80 prose prose-invert">
      <h1 className="text-3xl font-bold text-white mb-6">Terms of Service</h1>
      <p className="mb-4">Last Updated: {new Date().toLocaleDateString()}</p>
      
      <h2 className="text-xl font-bold text-white mt-8 mb-4">1. Acceptance of Terms</h2>
      <p>By accessing or using Velocity Data (this web app), you agree to be bound by these Terms of Service. This is a beta product provided "as is" without any warranties.</p>

      <h2 className="text-xl font-bold text-white mt-8 mb-4">2. Assumption of Risk & Medical Disclaimer</h2>
      <p className="font-bold text-orange-400">
        Velocity Data is not a medical device, nor a substitute for professional coaching. Weightlifting carries inherent risks of severe injury or death. The data, estimated 1-Rep Max (e1RM), and velocity tracking provided by the App are estimations for informational purposes only. You agree to assume 100% of the risk associated with your training. Velocity Data and its creator(s) are not liable for any injuries, damages, or health issues resulting from the use of this App.
      </p>

      <h2 className="text-xl font-bold text-white mt-8 mb-4">3. Data & Privacy</h2>
      <p>You agree not to upload or track videos containing individuals who have not consented to be recorded. You are responsible for ensuring your use of the App complies with your local gym's recording policies.</p>

      <h2 className="text-xl font-bold text-white mt-8 mb-4">4. Limitation of Liability</h2>
      <p>In no event shall the developer of Velocity Data be liable for any direct, indirect, incidental, or consequential damages arising out of the use or inability to use the App.</p>
    </div>
  );
}