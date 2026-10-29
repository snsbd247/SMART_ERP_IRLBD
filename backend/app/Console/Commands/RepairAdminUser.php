<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Hash;

class RepairAdminUser extends Command
{
    protected $signature = 'admin:repair
        {--username=ismail162 : Login username}
        {--email=ismailsagor162@gmail.com : Admin email}
        {--password=Admin@123 : Login password}
        {--name=Ismail Sagor : Display name}';

    protected $description = 'Create or repair a local Laravel Super Admin user for VPS installations';

    public function handle(): int
    {
        $username = trim((string) $this->option('username'));
        $email = trim((string) $this->option('email'));
        $password = (string) $this->option('password');
        $name = trim((string) $this->option('name')) ?: $username;

        $user = User::withTrashed()->where('username', $username)->first()
            ?: User::withTrashed()->where('email', $email)->first();

        $payload = [
            'username' => $username,
            'email' => $email,
            'name' => $name,
            'password' => Hash::make($password),
            'employee_id' => null,
            'branch_id' => null,
            'status' => 'active',
            'is_online' => false,
        ];

        if ($user) {
            if (method_exists($user, 'restore') && $user->trashed()) {
                $user->restore();
            }
            $user->forceFill($payload)->save();
            $this->info("✅ Super Admin repaired: {$username} / {$email}");
        } else {
            User::create($payload);
            $this->info("✅ Super Admin created: {$username} / {$email}");
        }

        $this->line('Login username: ' . $username);
        $this->line('Login email: ' . $email);
        $this->warn('Super Admin confirmed by employee_id = NULL.');

        return self::SUCCESS;
    }
}