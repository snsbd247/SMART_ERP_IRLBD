<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Symfony\Component\Process\Process;

class RunPhpUnitTest extends Command
{
    protected $signature = 'test
        {tests?* : Optional test files or directories to run}
        {--filter= : Filter which tests to run}
        {--testsuite= : Run a named PHPUnit test suite}
        {--group= : Run only tests from the specified group}
        {--exclude-group= : Exclude tests from the specified group}
        {--stop-on-failure : Stop after the first failure}
        {--testdox : Report test execution progress in TestDox format}
        {--debug : Display debugging information}
        {--log-junit= : Write a JUnit XML log file}
        {--coverage-clover= : Write code coverage report in Clover XML format}
        {--coverage-html= : Write code coverage report in HTML format}';

    protected $description = 'Run the PHPUnit test suite when Laravel\'s Collision test command is unavailable';

    public function handle(): int
    {
        $phpunit = base_path('vendor/bin/phpunit');

        if (! file_exists($phpunit)) {
            $this->error('PHPUnit is not installed. Run "composer install" without --no-dev, then retry this command.');

            return self::FAILURE;
        }

        $arguments = [PHP_BINARY, $phpunit];

        $configuration = base_path('phpunit.xml');
        if (file_exists($configuration)) {
            $arguments[] = '--configuration';
            $arguments[] = $configuration;
        }

        foreach (['filter', 'testsuite', 'group', 'exclude-group', 'log-junit', 'coverage-clover', 'coverage-html'] as $option) {
            $value = $this->option($option);

            if ($value !== null && $value !== false && $value !== '') {
                $arguments[] = '--' . $option;
                $arguments[] = (string) $value;
            }
        }

        foreach (['stop-on-failure', 'testdox', 'debug'] as $option) {
            if ($this->option($option)) {
                $arguments[] = '--' . $option;
            }
        }

        foreach ((array) $this->argument('tests') as $testPath) {
            $arguments[] = $testPath;
        }

        $process = new Process($arguments, base_path(), [
            'APP_ENV' => env('APP_ENV', 'testing'),
        ]);
        $process->setTimeout(null);
        $process->run(function ($type, $buffer): void {
            $this->output->write($buffer);
        });

        return $process->getExitCode() ?? self::FAILURE;
    }
}