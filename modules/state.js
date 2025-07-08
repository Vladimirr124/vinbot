const userData = new Map();
const userLogs = new Map();

function initUser(userId) {
  if (!userData.has(userId)) {
    userData.set(userId, { checks: 0, subscription: null, lang: null });
    userLogs.set(userId, { successful: 0, failed: 0 });
  }
}

function isSubscribed(userId) {
  const user = userData.get(userId);
  return user && user.subscription && new Date(user.subscription) > new Date();
}

function addSubscription(userId) {
  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + 6);
  userData.set(userId, { ...userData.get(userId), subscription: expiresAt });
}

function setUserLanguage(userId, lang) {
  if (userData.has(userId)) {
    userData.set(userId, { ...userData.get(userId), lang });
  }
}

module.exports = {
    userData,
    userLogs,
    initUser,
    isSubscribed,
    addSubscription,
    setUserLanguage
}; 