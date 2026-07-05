<?php
namespace App\Http\Controllers\Admin;
use App\Http\Controllers\CrudController;
use App\Models\Branch;
class BranchController extends CrudController
{
    protected string $modelClass = Branch::class;
    protected array $searchFields = ['name', 'code'];
    protected array $validationRules = [
        'code' => 'required|unique:branches',
        'name' => 'required|max:100',
        'latitude' => 'nullable|numeric|between:-90,90',
        'longitude' => 'nullable|numeric|between:-180,180',
        'geofence_radius_m' => 'nullable|integer|min:1|max:10000',
    ];
}
