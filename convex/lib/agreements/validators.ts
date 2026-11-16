const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const isEmailAddress = (value: string) => value.length <= 200 && EMAIL.test(value.trim());
