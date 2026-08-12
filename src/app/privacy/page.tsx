export default function Privacy() {
  return (
    <div className="max-w-3xl mx-auto p-8 text-white/80 prose prose-invert">
      <h1 className="text-3xl font-bold text-white mb-6">Privacy Policy</h1>
      
      <h2 className="text-xl font-bold text-white mt-8 mb-4">1. Information We Collect</h2>
      <p>We collect your email address and basic profile information when you authenticate via Google or Magic Link. We also store your workout data (sets, reps, velocity metrics, e1RM) to provide you with historical tracking.</p>

      <h2 className="text-xl font-bold text-white mt-8 mb-4">2. Video Processing</h2>
      <p>
        <strong>[CRITICAL: ADJUST THIS BASED ON YOUR APP]</strong> 
        Videos recorded or uploaded for velocity tracking are processed locally to perform computer vision analysis. The video never leaves your device, and is not stored. 
        Velocity data is stored for the purpose of training Rep Detection Algorithms, but no other data is stored. 
      </p>

      <h2 className="text-xl font-bold text-white mt-8 mb-4">3. Data Security</h2>
      <p>We use industry-standard security measures via Supabase to protect your data. However, no internet transmission is 100% secure. You use the App at your own risk.</p>

      <h2 className="text-xl font-bold text-white mt-8 mb-4">4. Deleting Your Data</h2>
      <p>You may request full deletion of your account and all associated data by contacting us via the feedback form provided in the App.</p>
    </div>
  );
}