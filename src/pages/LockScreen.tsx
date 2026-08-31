import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

/** Session keys are memory-only. Lock always returns to named-wallet unlock. */
function LockScreen() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate("/login-saved", { replace: true });
  }, [navigate]);
  return null;
}

export default LockScreen;
