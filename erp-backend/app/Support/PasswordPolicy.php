<?php

namespace App\Support;

/**
 * Centralised password strength policy used by both public registration
 * and password-reset flows. Returns null when the password is acceptable,
 * or a human-readable reason when it is not.
 */
class PasswordPolicy
{
    public const MIN_LENGTH = 8;

    /** @var string[] Common/banned passwords (lowercase). */
    protected static array $banned = [
        'password', 'password1', 'password123', 'admin', 'admin123',
        'qwerty', 'qwerty123', 'letmein', 'welcome', 'iloveyou',
        '12345678', '123456789', '1234567890', '11111111', '00000000',
        'abcdefgh', 'abc12345',
    ];

    public static function rules(): array
    {
        // Laravel validation rules (used together with custom validate()).
        return ['required', 'string', 'min:' . self::MIN_LENGTH, 'max:100', 'confirmed'];
    }

    public static function validate(?string $password): ?string
    {
        if ($password === null || $password === '') {
            return 'Password is required.';
        }
        if (strlen($password) < self::MIN_LENGTH) {
            return 'Password must be at least ' . self::MIN_LENGTH . ' characters.';
        }
        if (!preg_match('/[A-Za-z]/', $password)) {
            return 'Password must contain at least one letter.';
        }
        if (!preg_match('/\d/', $password)) {
            return 'Password must contain at least one number.';
        }
        if (preg_match('/^(.)\1+$/', $password)) {
            return 'Password cannot be a single repeated character.';
        }
        if (self::isSequential($password)) {
            return 'Password cannot be a simple sequence (e.g. 12345678, abcdefgh).';
        }
        if (in_array(strtolower($password), self::$banned, true)) {
            return 'This password is too common. Choose a stronger one.';
        }
        return null;
    }

    protected static function isSequential(string $p): bool
    {
        $lower = strtolower($p);
        $asc = $desc = true;
        for ($i = 1; $i < strlen($lower); $i++) {
            $diff = ord($lower[$i]) - ord($lower[$i - 1]);
            if ($diff !== 1) $asc = false;
            if ($diff !== -1) $desc = false;
        }
        return $asc || $desc;
    }
}
