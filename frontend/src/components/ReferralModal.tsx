import { useState, useEffect, useCallback } from 'react';
import { useSpacePoints, LEVEL_COLORS } from '@/context/SpacePointsContext';
import Image from 'next/image';

export function ReferralModal() {
  const {
    showReferralModal,
    pendingReferralCode,
    applyReferralCode,
    dismissReferralModal,
    validateReferralCode,
  } = useSpacePoints();

  const [referralCode, setReferralCode] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [isValid, setIsValid] = useState<boolean | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Pre-fill with pending code
  useEffect(() => {
    if (pendingReferralCode) {
      setReferralCode(pendingReferralCode);
      validateCode(pendingReferralCode);
    }
  }, [pendingReferralCode]);

  // Validate code with debounce
  const validateCode = useCallback(async (code: string) => {
    if (code.length < 4) {
      setIsValid(null);
      return;
    }

    setIsValidating(true);
    const valid = await validateReferralCode(code);
    setIsValid(valid);
    setIsValidating(false);
  }, [validateReferralCode]);

  // Handle code change with debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      if (referralCode.length >= 4) {
        validateCode(referralCode);
      } else {
        setIsValid(null);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [referralCode, validateCode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!referralCode || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    const result = await applyReferralCode(referralCode);
    
    if (result.success) {
      setSuccess(result.message);
      setTimeout(() => {
        dismissReferralModal();
      }, 2000);
    } else {
      setError(result.message);
    }

    setIsSubmitting(false);
  };

  const handleSkip = () => {
    dismissReferralModal();
  };

  if (!showReferralModal) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={handleSkip}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md mx-4 bg-[#141414] border border-[#262626] rounded-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-300">
        {/* Header with gradient */}
        <div className="relative h-32 bg-gradient-to-br from-[#3E8FF1] via-[#6366F1] to-[#8B5CF6] p-6 flex flex-col justify-center">
          <div className="absolute top-4 right-4">
            <button
              onClick={handleSkip}
              className="text-white/60 hover:text-white transition-colors"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Welcome to Space!</h2>
              <p className="text-sm text-white/80">Earn Points with referrals</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {success ? (
            <div className="text-center py-4">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
                <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-green-400 font-medium">{success}</p>
            </div>
          ) : (
            <>
              <p className="text-space-gray-400 text-sm mb-6">
                Have a referral code? Enter it below to earn <span className="text-white font-medium">100 Points</span> bonus!
              </p>

              <form onSubmit={handleSubmit}>
                <div className="relative mb-4">
                  <input
                    type="text"
                    value={referralCode}
                    onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                    placeholder="Enter referral code"
                    maxLength={16}
                    className={`w-full px-4 py-3 bg-[#1F1F1F] border rounded-lg text-white placeholder-space-gray-500 focus:outline-none focus:ring-2 transition-all ${
                      isValid === true
                        ? 'border-green-500/50 focus:ring-green-500/30'
                        : isValid === false
                        ? 'border-red-500/50 focus:ring-red-500/30'
                        : 'border-[#262626] focus:ring-space-primary/30'
                    }`}
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    {isValidating ? (
                      <svg className="w-5 h-5 text-space-gray-400 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : isValid === true ? (
                      <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : isValid === false ? (
                      <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    ) : null}
                  </div>
                </div>

                {error && (
                  <p className="text-red-400 text-sm mb-4">{error}</p>
                )}

                {isValid === false && referralCode.length >= 4 && (
                  <p className="text-red-400 text-sm mb-4">Invalid referral code</p>
                )}

                <button
                  type="submit"
                  disabled={!isValid || isSubmitting}
                  className="w-full py-3 bg-white hover:bg-gray-100 disabled:bg-white/50 disabled:cursor-not-allowed text-black font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Applying...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Apply Code & Earn 100 Points
                    </>
                  )}
                </button>
              </form>

              <button
                onClick={handleSkip}
                className="w-full mt-3 py-2.5 text-space-gray-400 hover:text-white text-sm font-medium transition-colors"
              >
                Skip for now
              </button>

              <div className="mt-6 pt-4 border-t border-[#262626]">
                <p className="text-xs text-space-gray-500 text-center">
                  You can always enter a referral code later from your profile
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
